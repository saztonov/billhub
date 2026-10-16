/**
 * Выгрузка счетов заявок на оплату в SIGNAL DOCS.
 *
 * Путь: <Проект>[/<подпапка>]/12. Снабжение/Счета/<Поставщик>/<№ заявки>_<имя файла>.
 *   - «12. Снабжение» должна существовать (иначе ошибка по проекту — сами не создаём);
 *   - «Счета» и папки поставщиков создаются при отсутствии; существующие с тем же
 *     нормализованным именем используются повторно; папка поставщика из прошлых успешных
 *     выгрузок (журнал) имеет приоритет.
 *
 * Идемпотентность: кандидаты — файлы без строки done в журнале. Перед созданием item
 * журнал фиксирует версию; если прогон оборвался после создания item, повтор находит
 * его в папке по имени и версии и не создаёт дубль.
 *
 * Бизнес-логика без инфраструктуры: БД, S3 и клиент SIGNAL инжектируются (тестируемо).
 */
import type { Logger } from 'pino';
import type { SgnlApi } from './sgnl-client.js';
import { describeSgnlError, isFatalSgnlError } from './sgnl-errors.js';
import {
  INVOICES_FOLDER_NAME,
  buildFileName,
  folderKey,
  guessMimeType,
  isSupplyFolder,
  supplierFolderNames,
  uniqueName,
} from './sgnl-names.js';
import type { SgnlFolderNode, SgnlItem } from './sgnl-types.js';
import type {
  SgnlExportStore,
  SgnlFileError,
  SgnlProjectReport,
  SgnlSyncCandidate,
  SgnlSyncReport,
} from './sgnl-sync-types.js';

/** Сколько ошибок по файлам попадает в отчёт */
export const MAX_REPORT_ERRORS = 100;

export interface SgnlSyncDeps {
  store: SgnlExportStore;
  client: SgnlApi;
  downloadFile: (fileKey: string) => Promise<Buffer>;
  log: Pick<Logger, 'info' | 'warn' | 'error'>;
  now?: () => Date;
}

export interface SgnlSyncOptions {
  dryRun: boolean;
  /** Ограничить выгрузку одним объектом (пилот) */
  siteId?: string;
}

/** Фатальная ошибка, прерывающая прогон */
class AbortRunError extends Error {}

/** Группа кандидатов: один проект SIGNAL + одна подпапка */
interface ProjectGroup {
  projectId: string;
  basePath: string | null;
  items: SgnlSyncCandidate[];
  report: SgnlProjectReport;
}

/** Папка в дереве: узел SIGNAL или ещё не созданная (dry-run) */
interface FolderRef {
  id: string | null;
  path: string;
  node: SgnlFolderNode | null;
  /** Создана в этом прогоне — заведомо пуста */
  created?: boolean;
}

function groupByProject(candidates: SgnlSyncCandidate[]): ProjectGroup[] {
  const groups = new Map<string, ProjectGroup>();
  for (const c of candidates) {
    const basePath = c.sgnlBasePath?.trim() || null;
    const key = `${c.sgnlProjectId}|${basePath ?? ''}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        projectId: c.sgnlProjectId,
        basePath,
        items: [],
        report: {
          projectId: c.sgnlProjectId,
          projectName: c.sgnlProjectName,
          basePath,
          sites: [],
          files: 0,
          uploaded: 0,
          failed: 0,
          foldersToCreate: [],
        },
      };
      groups.set(key, group);
    }
    group.items.push(c);
    group.report.files++;
    if (!group.report.sites.includes(c.siteName)) group.report.sites.push(c.siteName);
  }
  return [...groups.values()];
}

function findChild(node: SgnlFolderNode, match: (name: string) => boolean): SgnlFolderNode | null {
  return (node.children ?? []).find((child) => match(child.name)) ?? null;
}

function containsFolder(node: SgnlFolderNode, id: string): SgnlFolderNode | null {
  if (node.id === id) return node;
  for (const child of node.children ?? []) {
    const found = containsFolder(child, id);
    if (found) return found;
  }
  return null;
}

/** Выгрузка (или предпросмотр) счетов в SIGNAL; возвращает отчёт прогона */
export async function runSgnlSync(
  deps: SgnlSyncDeps,
  options: SgnlSyncOptions,
): Promise<SgnlSyncReport> {
  const now = deps.now ?? (() => new Date());
  const filter = options.siteId ? { siteId: options.siteId } : {};
  const report: SgnlSyncReport = {
    dryRun: options.dryRun,
    siteId: options.siteId ?? null,
    startedAt: now().toISOString(),
    finishedAt: '',
    totals: { candidates: 0, uploaded: 0, failed: 0 },
    projects: [],
    skipped: { unmappedSites: [], noSupplierFiles: 0 },
    errors: [],
  };

  const [candidates, skipped] = await Promise.all([
    deps.store.listCandidates(filter),
    deps.store.listSkipped(filter),
  ]);
  report.skipped = skipped;
  report.totals.candidates = candidates.length;

  const groups = groupByProject(candidates);
  report.projects = groups.map((g) => g.report);
  const trees = new Map<string, SgnlFolderNode>();

  try {
    for (const group of groups) {
      await processGroup(deps, options, group, trees, report);
    }
  } catch (error) {
    if (!(error instanceof AbortRunError)) throw error;
    report.aborted = error.message;
    deps.log.error({ reason: error.message }, 'SIGNAL: выгрузка прервана');
  }

  report.finishedAt = now().toISOString();
  return report;
}

/** Ошибка уровня проекта: все файлы группы учитываются как неуспешные */
function failGroup(group: ProjectGroup, report: SgnlSyncReport, message: string): void {
  group.report.error = message;
  if (!report.dryRun) {
    group.report.failed += group.items.length;
    report.totals.failed += group.items.length;
  }
}

async function processGroup(
  deps: SgnlSyncDeps,
  options: SgnlSyncOptions,
  group: ProjectGroup,
  trees: Map<string, SgnlFolderNode>,
  report: SgnlSyncReport,
): Promise<void> {
  let tree = trees.get(group.projectId);
  if (!tree) {
    try {
      tree = await deps.client.getFolderTree(group.projectId);
    } catch (error) {
      if (isFatalSgnlError(error)) throw new AbortRunError(describeSgnlError(error));
      failGroup(group, report, `Дерево папок проекта недоступно: ${describeSgnlError(error)}`);
      return;
    }
    trees.set(group.projectId, tree);
  }

  // Подпапка проекта (например «Дом 56»), внутри которой лежит «12. Снабжение»
  let base: SgnlFolderNode = tree;
  const baseSegments = (group.basePath ?? '')
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean);
  for (const segment of baseSegments) {
    const next = findChild(base, (name) => folderKey(name) === folderKey(segment));
    if (!next) {
      failGroup(group, report, `В проекте нет папки «${group.basePath}»`);
      return;
    }
    base = next;
  }

  const supply = findChild(base, isSupplyFolder);
  if (!supply) {
    failGroup(group, report, 'В проекте нет папки «12. Снабжение»');
    return;
  }
  const rootPath = [...baseSegments, supply.name].join('/');

  let invoices: FolderRef;
  try {
    invoices = await ensureFolder(
      deps,
      options,
      group,
      { id: supply.id, path: rootPath, node: supply },
      INVOICES_FOLDER_NAME,
    );
  } catch (error) {
    if (isFatalSgnlError(error)) throw new AbortRunError(describeSgnlError(error));
    failGroup(group, report, `Не удалось создать папку «Счета»: ${describeSgnlError(error)}`);
    return;
  }

  const known = options.dryRun
    ? new Map<string, string>()
    : await deps.store.listKnownSupplierFolders(group.projectId);
  const names = supplierFolderNames(
    group.items.map((c) => ({ id: c.supplierId, name: c.supplierName, inn: c.supplierInn })),
  );

  // Файлы по поставщикам
  const bySupplier = new Map<string, SgnlSyncCandidate[]>();
  for (const c of group.items)
    bySupplier.set(c.supplierId, [...(bySupplier.get(c.supplierId) ?? []), c]);

  for (const [supplierId, files] of bySupplier) {
    const folderName = names.get(supplierId)!;
    let supplierFolder: FolderRef;
    try {
      const knownId = known.get(supplierId);
      const knownNode = knownId && invoices.node ? containsFolder(invoices.node, knownId) : null;
      supplierFolder = knownNode
        ? { id: knownNode.id, path: `${invoices.path}/${knownNode.name}`, node: knownNode }
        : await ensureFolder(deps, options, group, invoices, folderName);
    } catch (error) {
      if (isFatalSgnlError(error)) throw new AbortRunError(describeSgnlError(error));
      for (const c of files) {
        await recordFailure(
          deps,
          report,
          group,
          c,
          `${invoices.path}/${folderName}`,
          buildFileName(c.requestNumber, c.fileName),
          null,
          error,
        );
      }
      continue;
    }

    if (options.dryRun) continue;
    await uploadSupplierFiles(deps, report, group, supplierFolder, files);
  }
}

/** Находит дочернюю папку по нормализованному имени или создаёт её (в dry-run — только учитывает) */
async function ensureFolder(
  deps: SgnlSyncDeps,
  options: SgnlSyncOptions,
  group: ProjectGroup,
  parent: FolderRef,
  name: string,
): Promise<FolderRef> {
  const path = `${parent.path}/${name}`;
  const existing = parent.node
    ? findChild(parent.node, (n) => folderKey(n) === folderKey(name))
    : null;
  if (existing) return { id: existing.id, path: `${parent.path}/${existing.name}`, node: existing };

  if (options.dryRun || !parent.id) {
    if (!group.report.foldersToCreate.includes(path)) group.report.foldersToCreate.push(path);
    return { id: null, path, node: null };
  }

  const id = await deps.client.createFolder(parent.id, name);
  const node: SgnlFolderNode = { id, name, children: [] };
  parent.node?.children.push(node);
  group.report.foldersToCreate.push(path);
  deps.log.info({ path }, 'SIGNAL: создана папка');
  return { id, path, node, created: true };
}

async function uploadSupplierFiles(
  deps: SgnlSyncDeps,
  report: SgnlSyncReport,
  group: ProjectGroup,
  folder: FolderRef,
  files: SgnlSyncCandidate[],
): Promise<void> {
  const folderId = folder.id!;
  let items: SgnlItem[];
  try {
    items = folder.created ? [] : await deps.client.listFolderItems(folderId);
  } catch (error) {
    if (isFatalSgnlError(error)) throw new AbortRunError(describeSgnlError(error));
    for (const c of files) {
      await recordFailure(
        deps,
        report,
        group,
        c,
        folder.path,
        buildFileName(c.requestNumber, c.fileName),
        folderId,
        error,
      );
    }
    return;
  }

  const taken = new Set(items.filter((i) => !i.deleted).map((i) => i.name.toLowerCase()));
  // Продолжение после сбоя: версия уже создана в этой же папке — имя за файлом закреплено
  const resumeOf = (c: SgnlSyncCandidate) =>
    c.previous?.sgnlVersionId && c.previous.sgnlFolderId === folderId ? c.previous : null;
  for (const c of files) {
    const resume = resumeOf(c);
    if (resume) taken.add(resume.targetName.toLowerCase());
  }

  for (const c of files) {
    const resume = resumeOf(c);
    const name = resume
      ? resume.targetName
      : uniqueName(buildFileName(c.requestNumber, c.fileName), taken);
    taken.add(name.toLowerCase());

    try {
      let versionId = resume?.sgnlVersionId ?? null;
      if (versionId) {
        const existing = items.find(
          (i) => !i.deleted && i.name === name && i.topVersionId === versionId,
        );
        if (existing) {
          await saveDone(
            deps,
            report,
            group,
            c,
            folder.path,
            name,
            folderId,
            versionId,
            existing.id,
          );
          continue;
        }
      } else {
        // Новая загрузка: id прежних объекта/версии (другая папка) больше не действительны
        await deps.store.save({
          candidate: c,
          status: 'pending',
          targetPath: folder.path,
          targetName: name,
          sgnlFolderId: folderId,
          sgnlObjectId: null,
          sgnlVersionId: null,
        });
        const body = await deps.downloadFile(c.fileKey);
        const uploaded = await deps.client.uploadVersion({
          projectId: group.projectId,
          folderId,
          name,
          mimeType: c.mimeType || guessMimeType(c.fileName),
          body,
        });
        versionId = uploaded.versionId;
        await deps.store.save({
          candidate: c,
          status: 'pending',
          targetPath: folder.path,
          targetName: name,
          sgnlFolderId: folderId,
          sgnlObjectId: uploaded.objectId,
          sgnlVersionId: versionId,
        });
      }

      const itemId = await deps.client.createFileItem(folderId, name, versionId);
      await saveDone(deps, report, group, c, folder.path, name, folderId, versionId, itemId);
    } catch (error) {
      await recordFailure(deps, report, group, c, folder.path, name, folderId, error);
      if (isFatalSgnlError(error)) throw new AbortRunError(describeSgnlError(error));
    }
  }
}

async function saveDone(
  deps: SgnlSyncDeps,
  report: SgnlSyncReport,
  group: ProjectGroup,
  c: SgnlSyncCandidate,
  path: string,
  name: string,
  folderId: string,
  versionId: string,
  itemId: string,
): Promise<void> {
  await deps.store.save({
    candidate: c,
    status: 'done',
    targetPath: path,
    targetName: name,
    sgnlFolderId: folderId,
    sgnlVersionId: versionId,
    sgnlItemId: itemId,
    lastError: null,
  });
  group.report.uploaded++;
  report.totals.uploaded++;
}

async function recordFailure(
  deps: SgnlSyncDeps,
  report: SgnlSyncReport,
  group: ProjectGroup,
  c: SgnlSyncCandidate,
  path: string,
  name: string,
  folderId: string | null,
  error: unknown,
): Promise<void> {
  const message = describeSgnlError(error);
  deps.log.warn({ fileId: c.fileId, path, err: message }, 'SIGNAL: файл не выгружен');
  group.report.failed++;
  report.totals.failed++;
  const entry: SgnlFileError = {
    requestNumber: c.requestNumber,
    fileName: c.fileName,
    path,
    error: message,
  };
  if (report.errors.length < MAX_REPORT_ERRORS) report.errors.push(entry);
  try {
    await deps.store.save({
      candidate: c,
      status: 'failed',
      targetPath: path,
      targetName: name,
      sgnlFolderId: folderId,
      lastError: message,
    });
  } catch (saveError) {
    deps.log.error(
      { err: saveError, fileId: c.fileId },
      'SIGNAL: не удалось записать ошибку в журнал',
    );
  }
}
