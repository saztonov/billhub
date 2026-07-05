/**
 * migrate-to-keycloak — CLI массового переноса `public.users` BillHub → Keycloak realm su10 (Ф3).
 * Режимы: preflight | import | verify | reconcile | report.
 *
 *   preflight  — только чтение: аномалии (HARD-блокеры vs warnings). exit≠0 при блокерах/превышении.
 *   import     — partialImport(SKIP) батчами, backfill атрибута, сверка sub, линки, группы. Требует
 *                --state и --ack-backup; import-креды billhub-import (KC_IMPORT_*, manage-realm).
 *   verify     — только чтение: DB↔KC↔группа↔billhub_user_id↔link; exit≠0 при дрейфе.
 *   reconcile  — приводит ТОЛЬКО БД-зеркало is_active к KC-группам (KC→БД); KC-группы не трогает.
 *   report     — сводка состояния.
 *
 * Секреты/хэши/токены НЕ печатаются. Реальный прогон на su10 — только после наката mapper+user-profile
 * (Предпосылка №0) и заведения billhub-import. Подробности — docs/keycloak-billhub.md §6.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';
import { buildKeycloakAdminPort, KeycloakImportClient } from './keycloak-migrate/admin.js';
import { parseArgs, type CliArgs, type Mode } from './keycloak-migrate/args.js';
import {
  runImport,
  runPreflight,
  runReconcile,
  runReport,
  runVerify,
} from './keycloak-migrate/runners.js';
import { createPgAdapters, type PgAdapters } from './keycloak-migrate/source.js';
import { FileCheckpoint } from './keycloak-migrate/state.js';
import { assertNotSupabase } from './migrate.js';

const ADVISORY_LOCK_KEY = 776655021;

function usage(): void {
  console.error(
    'Использование: migrate-to-keycloak <preflight|import|verify|reconcile|report> [опции]\n' +
      '  --database-url <pg>       целевая БД (по умолчанию DATABASE_URL)\n' +
      '  --dry-run                 не писать (import/reconcile)\n' +
      '  --allow-anomalies N       порог warnings в preflight (на блокеры не влияет)\n' +
      '  --state <file>            файл checkpoint/resume (обязателен для import)\n' +
      '  --report-file <file>      сохранить JSON-отчёт\n' +
      '  --approved-mapping <file> JSON {"<userId>":"<kcSub>"} для разрешённых mismatch\n' +
      '  --batch N                 размер батча import (по умолчанию 400)\n' +
      '  --ack-backup              подтверждение backup БД + realm-export (обязателен для import)\n' +
      '  --json                    печать отчёта в JSON',
  );
}

async function readJsonFile<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(file, 'utf8')) as T;
}

function importClient(): KeycloakImportClient {
  return new KeycloakImportClient({
    clientId: config.kcImportClientId || undefined,
    clientSecret: config.kcImportClientSecret || undefined,
    baseUrl: config.kcImportBaseUrl || undefined,
    realm: config.kcImportRealm || undefined,
  });
}

function output(args: CliArgs, human: string, data: unknown): void {
  if (args.json) console.log(JSON.stringify(data, null, 2));
  else console.log(human);
}

async function maybeWriteReport(args: CliArgs, data: unknown): Promise<void> {
  if (!args.reportFile) return;
  const { writeFile } = await import('node:fs/promises');
  await writeFile(args.reportFile, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

/** Возвращает код выхода (0 — успех). */
async function dispatch(mode: Mode, args: CliArgs, pg: PgAdapters): Promise<number> {
  const provider = config.authIdentityProvider;
  const groupActive = config.kcPortalGroupActive;
  const groupPending = config.kcPortalGroupPending;

  if (mode === 'preflight') {
    const { report, blocked } = await runPreflight({
      source: pg.source,
      allowAnomalies: args.allowAnomalies,
    });
    output(
      args,
      `preflight: всего ${report.total}, блокеров ${report.blockers}, warnings ${report.warnings}` +
        (blocked ? ' — СТАРТ ЗАПРЕЩЁН' : ' — можно импортировать') +
        '\nНапоминание: backup БД + realm-export su10 + метка cutover ДО import.',
      report,
    );
    await maybeWriteReport(args, report);
    return blocked ? 1 : 0;
  }

  if (mode === 'report') {
    const report = await runReport({ source: pg.source, links: pg.links, provider });
    output(
      args,
      `report: всего ${report.total}, с линком ${report.linked}, без линка ${report.unlinked}, ` +
        `null-пароль ${report.nullPassword}, подрядчиков ${report.counterparties}`,
      report,
    );
    await maybeWriteReport(args, report);
    return 0;
  }

  const kc = buildKeycloakAdminPort(importClient());

  if (mode === 'verify') {
    const report = await runVerify({
      source: pg.source,
      kc,
      links: pg.links,
      provider,
      groupActive,
      groupPending,
    });
    output(
      args,
      `verify: всего ${report.total}, с линком ${report.linked}, дрейф ${report.drift.length}`,
      report,
    );
    await maybeWriteReport(args, report);
    return report.drift.length > 0 ? 1 : 0;
  }

  if (mode === 'reconcile') {
    const report = await runReconcile({
      source: pg.source,
      kc,
      links: pg.links,
      mirror: pg.mirror,
      provider,
      groupActive,
      dryRun: args.dryRun,
    });
    output(
      args,
      `reconcile${report.dryRun ? ' (dry-run)' : ''}: линк ${report.linked}, зеркало обновлено ` +
        `${report.updated}, линков восстановлено ${report.linksRestored}, без линка ` +
        `${report.unresolved.length}, ошибок Admin ${report.retryable.length}`,
      report,
    );
    await maybeWriteReport(args, report);
    return report.retryable.length > 0 ? 1 : 0;
  }

  // import
  if (!config.kcImportClientId || !config.kcImportClientSecret) {
    console.error(
      'import: нужны import-креды manage-realm — задайте KC_IMPORT_CLIENT_ID и KC_IMPORT_CLIENT_SECRET ' +
        '(сервис-аккаунт billhub с manage-users для partialImport не годится).',
    );
    return 1;
  }
  if (!args.dryRun && (!args.state || !args.ackBackup)) {
    console.error(
      'import (non-dry-run): обязательны --state <file> и --ack-backup (подтверждение backup БД + realm-export).',
    );
    return 1;
  }

  const approvedMapping = args.approvedMapping
    ? await readJsonFile<Record<string, string>>(args.approvedMapping)
    : undefined;

  const report = await runImport({
    source: pg.source,
    kc,
    links: pg.links,
    provider,
    groupActive,
    groupPending,
    checkpoint: args.state ? new FileCheckpoint(args.state) : undefined,
    approvedMapping,
    batch: args.batch,
    dryRun: args.dryRun,
  });

  const c = report.counters;
  output(
    args,
    `import${report.dryRun ? ' (dry-run)' : ''}: всего ${report.total}, обработано ${c.processed}, ` +
      `added ${c.importedAdded}, skipped(dup) ${c.importedSkippedExisting}, без-пароля ${c.nullPassword}, ` +
      `линков ${c.linked}, active ${c.active}, pending ${c.pending}, backfill ${c.backfilled}, ` +
      `mismatch ${report.mismatches.length}, ошибок ${report.errors.length}` +
      (report.stopped ? ' — ОСТАНОВЛЕНО' : ''),
    report,
  );
  await maybeWriteReport(args, report);
  return report.stopped || report.mismatches.length > 0 || report.errors.length > 0 ? 1 : 0;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.mode) {
    usage();
    process.exit(1);
  }

  const databaseUrl = args.databaseUrl || config.databaseUrl || process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('Не задан --database-url или DATABASE_URL.');
    process.exit(1);
  }

  const mutating = args.mode === 'import' || (args.mode === 'reconcile' && !args.dryRun);
  if (mutating) {
    try {
      assertNotSupabase(databaseUrl);
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  }

  const pg = createPgAdapters(databaseUrl);
  let locked = false;
  try {
    if (mutating) {
      locked = await pg.tryAdvisoryLock(ADVISORY_LOCK_KEY);
      if (!locked) {
        console.error('Другой процесс migrate-to-keycloak уже выполняется (advisory-lock занят).');
        process.exit(1);
      }
    }
    const code = await dispatch(args.mode, args, pg);
    process.exitCode = code;
  } catch (err) {
    console.error('migrate-to-keycloak провалился:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  } finally {
    if (locked) await pg.advisoryUnlock(ADVISORY_LOCK_KEY);
    await pg.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main();
}
