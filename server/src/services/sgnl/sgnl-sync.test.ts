/**
 * Юнит-тесты логики выгрузки счетов в SIGNAL на фейковых хранилище и клиенте:
 * построение пути, создание и повторное использование папок, коллизии имён,
 * продолжение после сбоя, ошибки по файлу и по проекту, dry-run, фатальная ошибка.
 */
import { describe, expect, it, vi } from 'vitest';
import { runSgnlSync } from './sgnl-sync.js';
import type { SgnlApi, SgnlUploadInput } from './sgnl-client.js';
import { SgnlApiError, SgnlAuthError } from './sgnl-errors.js';
import type { SgnlFolderNode, SgnlItem } from './sgnl-types.js';
import type {
  SgnlExportStore,
  SgnlExportWrite,
  SgnlSkippedSummary,
  SgnlSyncCandidate,
} from './sgnl-sync-types.js';

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

function candidate(overrides: Partial<SgnlSyncCandidate> = {}): SgnlSyncCandidate {
  return {
    fileId: 'file-1',
    paymentRequestId: 'pr-1',
    requestNumber: '101',
    fileName: 'Счёт.pdf',
    fileKey: 'pr/101/1_schet.pdf',
    mimeType: 'application/pdf',
    siteId: 'site-1',
    siteName: 'ЖК Алия',
    sgnlProjectId: 'proj-1',
    sgnlProjectName: 'ЖК "Алия"',
    sgnlBasePath: null,
    supplierId: 'sup-1',
    supplierName: 'ООО "ЭК "ТЕМА"',
    supplierInn: '9717033912',
    previous: null,
    ...overrides,
  };
}

function folder(id: string, name: string, children: SgnlFolderNode[] = []): SgnlFolderNode {
  return { id, name, children };
}

/** Стандартное дерево: Root / 12. Снабжение / Договор поставки */
function defaultTree(): SgnlFolderNode {
  return folder('root', 'Root', [
    folder('rd', '2. РД'),
    folder('supply', '12. Снабжение', [folder('dp', 'Договор поставки')]),
  ]);
}

class FakeStore implements SgnlExportStore {
  writes: SgnlExportWrite[] = [];
  known = new Map<string, string>();
  skipped: SgnlSkippedSummary = { unmappedSites: [], noSupplierFiles: 0 };
  constructor(public candidates: SgnlSyncCandidate[]) {}
  async listCandidates(): Promise<SgnlSyncCandidate[]> {
    return this.candidates;
  }
  async listSkipped(): Promise<SgnlSkippedSummary> {
    return this.skipped;
  }
  async listKnownSupplierFolders(): Promise<Map<string, string>> {
    return this.known;
  }
  async save(write: SgnlExportWrite): Promise<void> {
    this.writes.push(write);
  }
  last(fileId: string): SgnlExportWrite | undefined {
    return [...this.writes].reverse().find((w) => w.candidate.fileId === fileId);
  }
}

class FakeClient implements SgnlApi {
  folders: Array<{ parentId: string; name: string; id: string }> = [];
  uploads: SgnlUploadInput[] = [];
  items: Array<{ folderId: string; name: string; versionId: string; id: string }> = [];
  folderItems = new Map<string, SgnlItem[]>();
  treeError: unknown = null;
  uploadError: unknown = null;
  itemError: unknown = null;
  private seq = 0;
  constructor(public tree: SgnlFolderNode) {}

  async listProjects() {
    return [];
  }
  async getFolderTree(): Promise<SgnlFolderNode> {
    if (this.treeError) throw this.treeError;
    return this.tree;
  }
  async listFolderItems(folderId: string): Promise<SgnlItem[]> {
    return this.folderItems.get(folderId) ?? [];
  }
  async createFolder(parentId: string, name: string): Promise<string> {
    const id = `new-folder-${++this.seq}`;
    this.folders.push({ parentId, name, id });
    return id;
  }
  async uploadVersion(input: SgnlUploadInput) {
    if (this.uploadError) throw this.uploadError;
    this.uploads.push(input);
    return { objectId: `obj-${++this.seq}`, versionId: `ver-${this.seq}` };
  }
  async createFileItem(folderId: string, name: string, versionId: string): Promise<string> {
    if (this.itemError) throw this.itemError;
    const id = `item-${++this.seq}`;
    this.items.push({ folderId, name, versionId, id });
    return id;
  }
}

function deps(store: FakeStore, client: FakeClient) {
  return {
    store,
    client,
    downloadFile: vi.fn(async (_fileKey: string) => Buffer.from('%PDF')),
    log,
  };
}

describe('runSgnlSync: выгрузка', () => {
  it('создаёт «Счета» и папку поставщика внутри «12. Снабжение» и выгружает файл', async () => {
    const store = new FakeStore([candidate()]);
    const client = new FakeClient(defaultTree());
    const report = await runSgnlSync(deps(store, client), { dryRun: false });

    expect(client.folders).toEqual([
      { parentId: 'supply', name: 'Счета', id: 'new-folder-1' },
      { parentId: 'new-folder-1', name: 'ООО ЭК ТЕМА', id: 'new-folder-2' },
    ]);
    expect(client.uploads[0]).toMatchObject({
      projectId: 'proj-1',
      folderId: 'new-folder-2',
      name: '101_Счёт.pdf',
    });
    expect(client.items[0]).toMatchObject({ folderId: 'new-folder-2', name: '101_Счёт.pdf' });
    expect(store.last('file-1')).toMatchObject({
      status: 'done',
      targetPath: '12. Снабжение/Счета/ООО ЭК ТЕМА',
      targetName: '101_Счёт.pdf',
      sgnlItemId: client.items[0]!.id,
    });
    expect(report.totals).toEqual({ candidates: 1, uploaded: 1, failed: 0 });
    expect(report.projects[0]!.foldersToCreate).toEqual([
      '12. Снабжение/Счета',
      '12. Снабжение/Счета/ООО ЭК ТЕМА',
    ]);
  });

  it('использует существующие папки по нормализованному имени и подпапку проекта', async () => {
    const tree = folder('root', 'Root', [
      folder('d56', 'Дом 56', [
        folder('supply', '12. Снабжение', [
          folder('inv', 'счета', [folder('sup-folder', 'ООО ЭК ТЕМА')]),
        ]),
      ]),
    ]);
    const store = new FakeStore([candidate({ sgnlBasePath: 'Дом 56' })]);
    const client = new FakeClient(tree);
    await runSgnlSync(deps(store, client), { dryRun: false });

    expect(client.folders).toEqual([]);
    expect(client.items[0]!.folderId).toBe('sup-folder');
    expect(store.last('file-1')!.targetPath).toBe('Дом 56/12. Снабжение/счета/ООО ЭК ТЕМА');
  });

  it('папка поставщика из прошлых выгрузок имеет приоритет над именем', async () => {
    const tree = folder('root', 'Root', [
      folder('supply', '12. Снабжение', [
        folder('inv', 'Счета', [folder('old', 'ТЕМА (старое имя)')]),
      ]),
    ]);
    const store = new FakeStore([candidate()]);
    store.known.set('sup-1', 'old');
    const client = new FakeClient(tree);
    await runSgnlSync(deps(store, client), { dryRun: false });
    expect(client.folders).toEqual([]);
    expect(client.items[0]!.folderId).toBe('old');
  });

  it('совпадающее имя в папке получает суффикс', async () => {
    const tree = folder('root', 'Root', [
      folder('supply', '12. Снабжение', [folder('inv', 'Счета', [folder('sf', 'ООО ЭК ТЕМА')])]),
    ]);
    const store = new FakeStore([candidate(), candidate({ fileId: 'file-2', fileKey: 'k2' })]);
    const client = new FakeClient(tree);
    client.folderItems.set('sf', [{ id: 'x', name: '101_Счёт.pdf', type: 'File', deleted: false }]);
    await runSgnlSync(deps(store, client), { dryRun: false });
    expect(client.items.map((i) => i.name)).toEqual(['101_Счёт (2).pdf', '101_Счёт (3).pdf']);
  });

  it('продолжение после сбоя: item уже создан — не дублирует, только отмечает done', async () => {
    const tree = folder('root', 'Root', [
      folder('supply', '12. Снабжение', [folder('inv', 'Счета', [folder('sf', 'ООО ЭК ТЕМА')])]),
    ]);
    const store = new FakeStore([
      candidate({
        previous: {
          status: 'pending',
          sgnlFolderId: 'sf',
          sgnlVersionId: 'ver-old',
          targetName: '101_Счёт.pdf',
          attempts: 0,
        },
      }),
    ]);
    const client = new FakeClient(tree);
    client.folderItems.set('sf', [
      {
        id: 'item-old',
        name: '101_Счёт.pdf',
        type: 'File',
        deleted: false,
        topVersionId: 'ver-old',
      },
    ]);
    const d = deps(store, client);
    await runSgnlSync(d, { dryRun: false });

    expect(client.uploads).toEqual([]);
    expect(client.items).toEqual([]);
    expect(d.downloadFile).not.toHaveBeenCalled();
    expect(store.last('file-1')).toMatchObject({ status: 'done', sgnlItemId: 'item-old' });
  });

  it('продолжение после сбоя: версия есть, item нет — создаёт item без повторной загрузки', async () => {
    const tree = folder('root', 'Root', [
      folder('supply', '12. Снабжение', [folder('inv', 'Счета', [folder('sf', 'ООО ЭК ТЕМА')])]),
    ]);
    const store = new FakeStore([
      candidate({
        previous: {
          status: 'failed',
          sgnlFolderId: 'sf',
          sgnlVersionId: 'ver-old',
          targetName: '101_Счёт.pdf',
          attempts: 1,
        },
      }),
    ]);
    const client = new FakeClient(tree);
    await runSgnlSync(deps(store, client), { dryRun: false });
    expect(client.uploads).toEqual([]);
    expect(client.items[0]).toMatchObject({
      folderId: 'sf',
      name: '101_Счёт.pdf',
      versionId: 'ver-old',
    });
  });

  it('имя незавершённой загрузки закреплено за своим файлом', async () => {
    const tree = folder('root', 'Root', [
      folder('supply', '12. Снабжение', [folder('inv', 'Счета', [folder('sf', 'ООО ЭК ТЕМА')])]),
    ]);
    const store = new FakeStore([
      candidate({ fileId: 'file-new', fileKey: 'k-new' }),
      candidate({
        fileId: 'file-resume',
        previous: {
          status: 'failed',
          sgnlFolderId: 'sf',
          sgnlVersionId: 'ver-old',
          targetName: '101_Счёт.pdf',
          attempts: 1,
        },
      }),
    ]);
    const client = new FakeClient(tree);
    await runSgnlSync(deps(store, client), { dryRun: false });
    expect(client.items.map((i) => [i.name, i.versionId])).toEqual([
      ['101_Счёт (2).pdf', expect.stringMatching(/^ver-/)],
      ['101_Счёт.pdf', 'ver-old'],
    ]);
    // Новая загрузка сбрасывает прежние id объекта/версии в журнале
    expect(store.writes[0]).toMatchObject({ sgnlObjectId: null, sgnlVersionId: null });
  });

  it('ошибка по файлу пишется в журнал и не останавливает прогон', async () => {
    const store = new FakeStore([candidate(), candidate({ fileId: 'file-2', fileKey: 'bad' })]);
    const client = new FakeClient(defaultTree());
    const d = deps(store, client);
    d.downloadFile.mockImplementation(async (key: string) => {
      if (key === 'bad') throw new Error('S3: нет объекта');
      return Buffer.from('%PDF');
    });
    const report = await runSgnlSync(d, { dryRun: false });

    expect(report.totals).toEqual({ candidates: 2, uploaded: 1, failed: 1 });
    expect(store.last('file-2')).toMatchObject({ status: 'failed', lastError: 'S3: нет объекта' });
    expect(report.errors[0]).toMatchObject({ requestNumber: '101', error: 'S3: нет объекта' });
  });

  it('ошибка после создания версии не затирает её id (продолжение в следующий прогон)', async () => {
    const store = new FakeStore([candidate()]);
    const client = new FakeClient(defaultTree());
    client.itemError = new SgnlApiError(500, 'PUT /public/v1/items/file', 'boom');
    await runSgnlSync(deps(store, client), { dryRun: false });

    const versionWrite = store.writes.find((w) => w.sgnlVersionId);
    expect(versionWrite).toMatchObject({ status: 'pending', sgnlVersionId: 'ver-3' });
    const failed = store.last('file-1')!;
    expect(failed.status).toBe('failed');
    expect(failed.sgnlVersionId).toBeUndefined();
  });

  it('нет «12. Снабжение» — ошибка по проекту, файлы учитываются как неуспешные', async () => {
    const store = new FakeStore([candidate()]);
    const client = new FakeClient(folder('root', 'Root', [folder('rd', '2. РД')]));
    const report = await runSgnlSync(deps(store, client), { dryRun: false });
    expect(report.projects[0]!.error).toContain('12. Снабжение');
    expect(report.totals.failed).toBe(1);
    expect(client.folders).toEqual([]);
  });

  it('фатальная ошибка авторизации прерывает прогон', async () => {
    const store = new FakeStore([
      candidate(),
      candidate({ fileId: 'file-2', sgnlProjectId: 'proj-2' }),
    ]);
    const client = new FakeClient(defaultTree());
    client.uploadError = new SgnlAuthError(422, 'ScopeError', 'нет scopes');
    const report = await runSgnlSync(deps(store, client), { dryRun: false });
    expect(report.aborted).toContain('ScopeError');
    expect(store.last('file-2')).toBeUndefined();
  });
});

describe('runSgnlSync: предпросмотр', () => {
  it('ничего не создаёт и не загружает, но показывает папки к созданию и пропуски', async () => {
    const store = new FakeStore([
      candidate(),
      candidate({
        fileId: 'file-2',
        supplierId: 'sup-2',
        supplierName: 'ООО "ЛИГА"',
        supplierInn: '1',
      }),
    ]);
    store.skipped = {
      unmappedSites: [{ siteId: 's9', siteName: 'ГО', files: 9 }],
      noSupplierFiles: 3,
    };
    const client = new FakeClient(defaultTree());
    const d = deps(store, client);
    const report = await runSgnlSync(d, { dryRun: true });

    expect(client.folders).toEqual([]);
    expect(client.uploads).toEqual([]);
    expect(d.downloadFile).not.toHaveBeenCalled();
    expect(store.writes).toEqual([]);
    expect(report.dryRun).toBe(true);
    expect(report.projects[0]).toMatchObject({ files: 2, uploaded: 0, failed: 0 });
    expect(report.projects[0]!.foldersToCreate).toEqual([
      '12. Снабжение/Счета',
      '12. Снабжение/Счета/ООО ЭК ТЕМА',
      '12. Снабжение/Счета/ООО ЛИГА',
    ]);
    expect(report.skipped).toEqual(store.skipped);
  });

  it('недоступное дерево проекта — ошибка проекта без падения прогона', async () => {
    const store = new FakeStore([candidate()]);
    const client = new FakeClient(defaultTree());
    client.treeError = new SgnlApiError(403, 'GET tree', 'Forbidden');
    const report = await runSgnlSync(deps(store, client), { dryRun: true });
    expect(report.projects[0]!.error).toContain('недоступно');
    expect(report.aborted).toBeUndefined();
  });
});
