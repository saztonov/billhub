#!/usr/bin/env node
/**
 * export-approved-invoices — разовая выгрузка в ZIP действующих счетов согласованных заявок на
 * оплату одного контрагента по одному объекту (БД + хранилище файлов).
 *
 * Что попадает в архив: вложения с типом документа «Счет», не зачёркнутые в заявке
 * (is_rejected = false), у заявок на оплату в статусе «Согласована» (statuses.code = 'approved'),
 * не удалённых, выбранного контрагента (по ИНН) и объекта (по точному названию). Критерии зашиты —
 * флагов для их смягчения нет. Раскладка: {поставщик}/{номер заявки}_{имя файла} + registry.csv.
 *
 * Формат .mjs (а не TS-CLI в server/src/cli) выбран сознательно: скрипт запускается в уже
 * собранном образе billhub-api без пересборки и деплоя — нужные зависимости (postgres.js,
 * @aws-sdk/client-s3) и env уже есть внутри контейнера.
 *
 * ТОЛЬКО ЧТЕНИЕ: в БД — SELECT, в хранилище — GetObject. Ничего не изменяет.
 *
 * Запуск на VPS (из /opt/portals/billhub, после git pull):
 *   mkdir -p /var/lib/billhub/export && chmod 700 /var/lib/billhub/export
 *   docker compose -f deploy/docker-compose.prod.yml -p billhub run --rm --no-deps \
 *     --user "$(id -u):$(id -g)" \
 *     -v /opt/portals/billhub/deploy/tools:/app/tools:ro \
 *     -v /var/lib/billhub/export:/export \
 *     billhub-api node /app/tools/export-approved-invoices.mjs --out /export \
 *       --counterparty-inn 7716967786 --site "ЖК Зиларт лот 33" --dry-run
 *
 * Флаги:
 *   --out <dir>                 каталог, куда кладётся архив (обязателен)
 *   --counterparty-inn <ИНН>    ИНН контрагента (обязателен)
 *   --site <название>           точное название объекта (обязателен)
 *   --dry-run                   только подсчёт и реестр, без скачивания и архива
 *   --concurrency N             параллельных скачиваний (по умолчанию 4)
 */
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import postgres from 'postgres';
import { createProgressLogger, csvContent, formatSize } from './lib/export-common.mjs';
import { buildArchiveName, buildRegistryCsv, planLayout } from './lib/approved-invoices-layout.mjs';
import { downloadAll, resolveStorage } from './lib/s3-download.mjs';
import { ZipWriter } from './lib/zip-writer.mjs';

/** Код статуса «Согласована» в справочнике statuses (entity_type = 'payment_request'). */
const APPROVED_STATUS_CODE = 'approved';
/** Тип документа «Счет» (тот же ID, что в OCR и выгрузке в SIGNAL). */
const INVOICE_DOC_TYPE_ID = 'c3c0b242-8a0c-4e20-b9ad-363ebf462a5b';

/* ------------------------------- Аргументы -------------------------------- */

/** Разбор argv в объект опций. Неизвестный флаг — ошибка (защита от опечаток). */
export function parseArgs(argv) {
  const opts = { out: '', counterpartyInn: '', site: '', dryRun: false, concurrency: 4 };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const value = argv[i + 1];
      if (value === undefined) throw new Error(`Флаг ${arg} требует значения`);
      i += 1;
      return value;
    };

    switch (arg) {
      case '--out':
        opts.out = next();
        break;
      case '--counterparty-inn':
        opts.counterpartyInn = next().trim();
        break;
      case '--site':
        opts.site = next().trim();
        break;
      case '--dry-run':
        opts.dryRun = true;
        break;
      case '--concurrency':
        opts.concurrency = Number(next());
        break;
      default:
        throw new Error(`Неизвестный аргумент: ${arg}`);
    }
  }

  if (!opts.out) throw new Error('Не указан --out <dir>');
  if (!/^\d{10}(\d{2})?$/.test(opts.counterpartyInn)) {
    throw new Error('--counterparty-inn ожидает ИНН из 10 или 12 цифр');
  }
  if (!opts.site) throw new Error('Не указан --site <название объекта>');
  if (!Number.isInteger(opts.concurrency) || opts.concurrency < 1 || opts.concurrency > 16) {
    throw new Error('--concurrency должен быть целым от 1 до 16');
  }
  return opts;
}

/* --------------------------------- Выборка -------------------------------- */

/** Ровно одна запись справочника, иначе — понятная ошибка (не угадываем при дублях). */
function single(rows, what) {
  if (rows.length === 0) throw new Error(`${what}: не найден`);
  if (rows.length > 1) {
    const list = rows.map((row) => `${String(row.name).trim()} (${row.id})`).join('; ');
    throw new Error(`${what}: найдено несколько — ${list}`);
  }
  return rows[0];
}

/** Контрагент по ИНН и объект по точному названию (хвостовые пробелы в БД не мешают). */
async function resolveScope(sql, opts) {
  const [counterparties, sites] = await Promise.all([
    sql`select id, name, inn from counterparties where btrim(inn) = ${opts.counterpartyInn}`,
    sql`select id, name from construction_sites where btrim(name) = ${opts.site}`,
  ]);
  return {
    counterparty: single(counterparties, `Контрагент с ИНН ${opts.counterpartyInn}`),
    site: single(sites, `Объект «${opts.site}»`),
  };
}

/** Действующие счета согласованных заявок контрагента по объекту. */
async function fetchInvoiceFiles(sql, scope) {
  return sql`
    select
      f.id              as file_id,
      f.file_key        as file_key,
      f.file_name       as file_name,
      f.file_size       as file_size,
      f.created_at      as file_created_at,
      pr.request_number as request_number,
      pr.created_at     as request_created_at,
      pr.approved_at    as request_approved_at,
      pr.invoice_amount as invoice_amount,
      ps.name           as paid_status_name,
      sp.id             as supplier_id,
      sp.name           as supplier_name,
      sp.inn            as supplier_inn
    from payment_request_files f
      join payment_requests pr on pr.id = f.payment_request_id
      join statuses st on st.id = pr.status_id and st.entity_type = 'payment_request'
      left join statuses ps on ps.id = pr.paid_status_id
      left join suppliers sp on sp.id = pr.supplier_id
    where pr.counterparty_id = ${scope.counterparty.id}
      and pr.site_id = ${scope.site.id}
      and pr.is_deleted = false
      and st.code = ${APPROVED_STATUS_CODE}
      and f.document_type_id = ${INVOICE_DOC_TYPE_ID}
      and f.is_rejected = false
    order by sp.name nulls last, pr.request_number, f.created_at
  `;
}

/**
 * Согласованные заявки без единого действующего счёта.
 * Нужны, чтобы по логу было видно: неполнота выгрузки — из-за данных, а не сбоя.
 */
async function fetchRequestsWithoutInvoice(sql, scope) {
  return sql`
    select pr.request_number as request_number, sp.name as supplier_name
    from payment_requests pr
      join statuses st on st.id = pr.status_id and st.entity_type = 'payment_request'
      left join suppliers sp on sp.id = pr.supplier_id
    where pr.counterparty_id = ${scope.counterparty.id}
      and pr.site_id = ${scope.site.id}
      and pr.is_deleted = false
      and st.code = ${APPROVED_STATUS_CODE}
      and not exists (
        select 1 from payment_request_files f
        where f.payment_request_id = pr.id
          and f.document_type_id = ${INVOICE_DOC_TYPE_ID}
          and f.is_rejected = false
      )
    order by pr.request_number
  `;
}

/* --------------------------------- Упаковка ------------------------------- */

/** Отчёт о нескачанных файлах — рядом с архивом, внутрь он не кладётся. */
async function writeErrorsCsv(outDir, errors) {
  const errorsPath = path.join(outDir, 'errors.csv');
  await writeFile(
    errorsPath,
    csvContent(
      ['Поставщик', 'Номер заявки', 'Имя файла', 'Ключ в хранилище', 'Ошибка'],
      errors.map(({ item, message }) => [
        item.supplier_name,
        item.request_number,
        item.file_name,
        item.file_key,
        message,
      ]),
    ),
    'utf8',
  );
  return errorsPath;
}

/** Собирает архив: сначала реестр, затем файлы в порядке раскладки. */
async function packArchive(zipPath, items, tempDir, registryCsv, startedAt) {
  const zip = new ZipWriter(zipPath, startedAt);
  await zip.addBuffer('registry.csv', registryCsv);
  for (const item of items) {
    await zip.addFile(item.relativePath, path.join(tempDir, item.relativePath));
  }
  return zip.close();
}

/* ---------------------------------- Main ---------------------------------- */

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const startedAt = new Date();

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('Не задана переменная окружения DATABASE_URL');

  // Хранилище резолвим до похода в БД: незачем делать выборку, если выгружать некуда
  const storage = opts.dryRun ? null : resolveStorage();
  if (storage) console.log(`Хранилище: ${storage.provider}, бакет ${storage.bucket}`);

  const sql = postgres(databaseUrl, { prepare: false, max: 2, idle_timeout: 20 });

  let scope;
  let items;
  let withoutInvoice;
  try {
    scope = await resolveScope(sql, opts);
    console.log(
      `Контрагент: ${String(scope.counterparty.name).trim()} (ИНН ${String(scope.counterparty.inn).trim()})`,
    );
    console.log(`Объект: ${String(scope.site.name).trim()}`);
    console.log('Выборка: заявки «Согласована», тип документа «Счет», без зачёркнутых');
    const [fileRows, missingRows] = await Promise.all([
      fetchInvoiceFiles(sql, scope),
      fetchRequestsWithoutInvoice(sql, scope),
    ]);
    items = planLayout(fileRows);
    withoutInvoice = missingRows;
  } finally {
    await sql.end({ timeout: 5 });
  }

  const totalSize = items.reduce((sum, item) => sum + Number(item.file_size ?? 0), 0);
  const requests = new Set(items.map((item) => item.request_number)).size;
  const suppliers = new Set(items.map((item) => item.folder)).size;
  console.log(
    `Найдено файлов: ${items.length}, заявок: ${requests}, поставщиков: ${suppliers}, ` +
      `ожидаемый объём: ${formatSize(totalSize)}`,
  );
  console.log(`Согласованных заявок без действующего счёта: ${withoutInvoice.length}`);
  for (const row of withoutInvoice) {
    console.log(`  ${row.request_number} — ${String(row.supplier_name ?? 'без поставщика').trim()}`);
  }

  if (items.length === 0) {
    console.log('Нечего выгружать — выборка пуста.');
    return;
  }

  await mkdir(opts.out, { recursive: true });

  if (opts.dryRun) {
    const registryPath = path.join(opts.out, 'registry.csv');
    await writeFile(registryPath, buildRegistryCsv(items, null), 'utf8');
    console.log(`Режим --dry-run: файлы не скачивались. Реестр: ${registryPath}`);
    return;
  }

  // Сначала на диск, потом упаковка: при обрыве сети архив не окажется битым,
  // а повторный запуск дотянет недостающее (файлы совпадающего размера не перекачиваются)
  const tempDir = path.join(opts.out, '.tmp-approved-invoices');
  await mkdir(tempDir, { recursive: true });

  console.log(`Скачивание во временный каталог (параллельно: ${opts.concurrency})...`);
  const result = await downloadAll(
    storage.client,
    storage.bucket,
    items,
    tempDir,
    opts.concurrency,
    createProgressLogger(),
  );

  const packed = items.filter((item) => !result.failed.has(item.relativePath));
  if (packed.length === 0) {
    await writeErrorsCsv(opts.out, result.errors);
    throw new Error(
      `Не скачался ни один файл (ошибок: ${result.errors.length}) — архив не создан, см. errors.csv`,
    );
  }

  const zipPath = path.join(opts.out, buildArchiveName(scope.counterparty.name, scope.site.name, startedAt));
  console.log(`Упаковка в ${zipPath}...`);
  const archive = await packArchive(zipPath, packed, tempDir, buildRegistryCsv(items, result.failed), startedAt);

  if (result.errors.length > 0) {
    const errorsPath = await writeErrorsCsv(opts.out, result.errors);
    console.log(`Ошибки записаны: ${errorsPath}. Временный каталог сохранён для повторного прогона: ${tempDir}`);
  } else {
    await rm(tempDir, { recursive: true, force: true });
  }

  console.log(
    `Готово. Архив: ${zipPath} (${formatSize(archive.bytes)}, записей: ${archive.entries}). ` +
      `Скачано: ${result.downloaded}, пропущено (уже были): ${result.skipped}, ошибок: ${result.errors.length}.`,
  );
  if (result.errors.length > 0) process.exitCode = 1;
}

// main запускается только при прямом вызове файла — при импорте (проверки логики) не выполняется
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`ОШИБКА: ${error?.message ?? error}`);
    process.exit(1);
  });
}
