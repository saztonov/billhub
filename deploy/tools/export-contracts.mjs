#!/usr/bin/env node
/**
 * export-contracts — разовая выгрузка подписанных договоров из BillHub (БД + Cloud.ru S3) в ZIP.
 *
 * Что попадает в архив: файлы с признаком «Подписанный договор» (is_signed_contract) у заявок
 * раздела «Договора» в статусе «Заключен» (statuses.code = 'concluded'). Отклонённые файлы и
 * удалённые заявки исключены — критерии зашиты, флагов для их смягчения нет.
 *
 * Формат .mjs (а не TS-CLI в server/src/cli) выбран сознательно: скрипт запускается в уже
 * собранном образе billhub-api без пересборки и деплоя — нужные зависимости (postgres.js,
 * @aws-sdk/client-s3) и env уже есть внутри контейнера. ZIP собирается своим writer'ом на
 * встроенном zlib: в образе нет ни архиватора, ни утилиты zip.
 *
 * ТОЛЬКО ЧТЕНИЕ: в БД — SELECT, в S3 — GetObject. Ничего не изменяет.
 *
 * Запуск на VPS (из /opt/portals/billhub, после git pull):
 *   mkdir -p /var/lib/billhub/export && chmod 700 /var/lib/billhub/export
 *   docker compose -f deploy/docker-compose.prod.yml -p billhub run --rm \
 *     --user "$(id -u):$(id -g)" \
 *     -v /opt/portals/billhub/deploy/tools:/app/tools:ro \
 *     -v /var/lib/billhub/export:/export \
 *     billhub-api node /app/tools/export-contracts.mjs --out /export --dry-run
 *
 * Флаги:
 *   --out <dir>           каталог, куда кладётся архив (обязателен)
 *   --dry-run             только подсчёт и реестры, без скачивания и архива
 *   --concurrency N       параллельных скачиваний (по умолчанию 4)
 */
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import postgres from 'postgres';
import {
  createProgressLogger,
  csvContent,
  csvDate,
  formatSize,
  sanitizeFsName,
  uniqueName,
} from './lib/export-common.mjs';
import { downloadAll, resolveStorage } from './lib/s3-download.mjs';
import { ZipWriter } from './lib/zip-writer.mjs';

/** Код статуса «Заключен» в справочнике statuses (entity_type = 'contract_request'). */
const CONCLUDED_STATUS_CODE = 'concluded';

/* ------------------------------- Аргументы -------------------------------- */

/** Разбор argv в объект опций. Неизвестный флаг — ошибка (защита от опечаток). */
export function parseArgs(argv) {
  const opts = { out: '', dryRun: false, concurrency: 4 };

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
  if (!Number.isInteger(opts.concurrency) || opts.concurrency < 1 || opts.concurrency > 16) {
    throw new Error('--concurrency должен быть целым от 1 до 16');
  }
  return opts;
}

/* --------------------------------- Выборка -------------------------------- */

/** Подписанные договоры заключённых заявок с метаданными объекта, поставщика и контрагента. */
async function fetchSignedContractFiles(sql) {
  return sql`
    select
      f.id                     as file_id,
      f.file_key               as file_key,
      f.file_name              as file_name,
      f.file_size              as file_size,
      f.created_at             as file_created_at,
      cr.request_number        as request_number,
      cr.contract_number       as contract_number,
      cr.contract_signing_date as contract_signing_date,
      cs.name                  as site_name,
      s.id                     as supplier_id,
      s.name                   as supplier_name,
      s.inn                    as supplier_inn,
      cp.name                  as counterparty_name,
      cp.inn                   as counterparty_inn
    from contract_request_files f
      join contract_requests cr on cr.id = f.contract_request_id
      join statuses st on st.id = cr.status_id and st.entity_type = 'contract_request'
      join construction_sites cs on cs.id = cr.site_id
      join suppliers s on s.id = cr.supplier_id
      join counterparties cp on cp.id = cr.counterparty_id
    where st.code = ${CONCLUDED_STATUS_CODE}
      and cr.is_deleted = false
      and f.is_signed_contract = true
      and f.is_rejected = false
    order by cs.name, s.name, cr.request_number, f.created_at
  `;
}

/**
 * Заключённые заявки, у которых подписанного файла нет вовсе.
 * Нужны, чтобы по архиву было видно: выгрузка неполна из-за отсутствия документа, а не сбоя.
 */
async function fetchContractsWithoutSignedFile(sql) {
  return sql`
    select
      cr.request_number        as request_number,
      cr.contract_number       as contract_number,
      cr.contract_signing_date as contract_signing_date,
      cs.name                  as site_name,
      s.name                   as supplier_name,
      cp.name                  as counterparty_name
    from contract_requests cr
      join statuses st on st.id = cr.status_id and st.entity_type = 'contract_request'
      join construction_sites cs on cs.id = cr.site_id
      join suppliers s on s.id = cr.supplier_id
      join counterparties cp on cp.id = cr.counterparty_id
    where st.code = ${CONCLUDED_STATUS_CODE}
      and cr.is_deleted = false
      and not exists (
        select 1 from contract_request_files f
        where f.contract_request_id = cr.id
          and f.is_signed_contract = true
          and f.is_rejected = false
      )
    order by cs.name, s.name, cr.request_number
  `;
}

/* -------------------------------- Раскладка ------------------------------- */

/** Достраивает для каждой строки путь внутри архива: {объект}/{поставщик}/{номер заявки}_{имя}. */
export function planLayout(rows) {
  const usedByFolder = new Map();

  // В справочнике поставщиков встречаются разные юрлица с одинаковым названием — такие папки
  // различаем по ИНН, иначе договоры двух поставщиков смешались бы в одном каталоге
  const idsByName = new Map();
  for (const row of rows) {
    const name = sanitizeFsName(row.supplier_name, 'Без поставщика');
    if (!idsByName.has(name)) idsByName.set(name, new Set());
    idsByName.get(name).add(row.supplier_id);
  }

  return rows.map((row) => {
    const siteFolder = sanitizeFsName(row.site_name, 'Без объекта');
    const baseSupplier = sanitizeFsName(row.supplier_name, 'Без поставщика');
    const supplierFolder =
      idsByName.get(baseSupplier).size > 1 && row.supplier_inn
        ? sanitizeFsName(`${baseSupplier} (ИНН ${row.supplier_inn})`, baseSupplier)
        : baseSupplier;

    const folder = `${siteFolder}/${supplierFolder}`;
    if (!usedByFolder.has(folder)) usedByFolder.set(folder, new Set());

    // Номер заявки в имени связывает файл со строкой реестра: у одной пары объект/поставщик
    // может быть несколько договоров
    const baseName = sanitizeFsName(row.file_name, `${row.file_id}.bin`);
    const numbered = row.request_number ? `${sanitizeFsName(row.request_number)}_${baseName}` : baseName;
    const fileName = uniqueName(sanitizeFsName(numbered, baseName), usedByFolder.get(folder));

    return { ...row, siteFolder, supplierFolder, fileName, relativePath: `${folder}/${fileName}` };
  });
}

/* --------------------------------- Реестры -------------------------------- */

const REGISTRY_HEADER = [
  'Объект',
  'Поставщик',
  'ИНН поставщика',
  'Контрагент',
  'Номер заявки',
  'Номер договора',
  'Дата подписания',
  'Дата загрузки файла',
  'Имя файла',
  'Размер, байт',
  'Путь в архиве',
  'В архиве',
];

/** Реестр выгруженных файлов. failed = null в режиме --dry-run (скачивания не было). */
export function buildRegistryCsv(items, failed) {
  return csvContent(
    REGISTRY_HEADER,
    items.map((item) => [
      item.site_name,
      item.supplier_name,
      item.supplier_inn,
      item.counterparty_name,
      item.request_number,
      item.contract_number,
      csvDate(item.contract_signing_date),
      csvDate(item.file_created_at),
      item.file_name,
      item.file_size,
      item.relativePath,
      failed === null ? '—' : failed.has(item.relativePath) ? 'нет' : 'да',
    ]),
  );
}

/** Реестр заключённых договоров без подписанного файла. */
export function buildMissingCsv(rows) {
  return csvContent(
    ['Объект', 'Поставщик', 'Контрагент', 'Номер заявки', 'Номер договора', 'Дата подписания'],
    rows.map((row) => [
      row.site_name,
      row.supplier_name,
      row.counterparty_name,
      row.request_number,
      row.contract_number,
      csvDate(row.contract_signing_date),
    ]),
  );
}

/** Отчёт о нескачанных файлах — рядом с архивом, внутрь он не кладётся. */
async function writeErrorsCsv(outDir, errors) {
  const errorsPath = path.join(outDir, 'errors.csv');
  await writeFile(
    errorsPath,
    csvContent(
      ['Объект', 'Поставщик', 'Номер заявки', 'Имя файла', 'Ключ в хранилище', 'Ошибка'],
      errors.map(({ item, message }) => [
        item.site_name,
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

/* --------------------------------- Упаковка ------------------------------- */

/** Собирает архив: сначала реестры, затем файлы в порядке раскладки. */
export async function packArchive(zipPath, items, tempDir, registryCsv, missingCsv, startedAt) {
  const zip = new ZipWriter(zipPath, startedAt);
  await zip.addBuffer('registry.csv', registryCsv);
  await zip.addBuffer('missing.csv', missingCsv);
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

  let items;
  let missing;
  try {
    console.log('Выборка: заявки в статусе «Заключен», файлы с признаком «Подписанный договор»');
    const [fileRows, missingRows] = await Promise.all([
      fetchSignedContractFiles(sql),
      fetchContractsWithoutSignedFile(sql),
    ]);
    items = planLayout(fileRows);
    missing = missingRows;
  } finally {
    await sql.end({ timeout: 5 });
  }

  const totalSize = items.reduce((sum, item) => sum + Number(item.file_size ?? 0), 0);
  const sites = new Set(items.map((item) => item.siteFolder)).size;
  const requests = new Set(items.map((item) => item.request_number)).size;
  console.log(
    `Найдено файлов: ${items.length}, заявок: ${requests}, объектов: ${sites}, ` +
      `ожидаемый объём: ${formatSize(totalSize)}`,
  );
  console.log(`Заключённых договоров без подписанного файла: ${missing.length}`);
  for (const row of missing) {
    console.log(`  ${row.request_number} — ${String(row.supplier_name).trim()} (${String(row.site_name).trim()})`);
  }

  if (items.length === 0) {
    console.log('Нечего выгружать — выборка пуста.');
    return;
  }

  await mkdir(opts.out, { recursive: true });
  const missingCsv = buildMissingCsv(missing);

  if (opts.dryRun) {
    const registryPath = path.join(opts.out, 'registry.csv');
    const missingPath = path.join(opts.out, 'missing.csv');
    await writeFile(registryPath, buildRegistryCsv(items, null), 'utf8');
    await writeFile(missingPath, missingCsv, 'utf8');
    console.log(`Режим --dry-run: файлы не скачивались. Реестры: ${registryPath}, ${missingPath}`);
    return;
  }

  // Сначала на диск, потом упаковка: при обрыве сети архив не окажется битым,
  // а повторный запуск дотянет недостающее (файлы совпадающего размера не перекачиваются)
  const tempDir = path.join(opts.out, '.tmp-contracts');
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
  const archiveName = `contracts-signed-${startedAt.toISOString().slice(0, 10)}.zip`;
  const zipPath = path.join(opts.out, archiveName);
  console.log(`Упаковка в ${zipPath}...`);
  const archive = await packArchive(
    zipPath,
    packed,
    tempDir,
    buildRegistryCsv(items, result.failed),
    missingCsv,
    startedAt,
  );

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
