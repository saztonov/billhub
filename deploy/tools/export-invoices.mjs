#!/usr/bin/env node
/**
 * export-invoices — разовая выгрузка файлов счетов из BillHub (БД + Cloud.ru S3).
 *
 * Зачем: в БД хранится только ключ объекта (`file_key`), бакет приватный — выкачать файлы
 * можно лишь подписанными запросами с сервера. Скрипт собирает счета в каталог с папками
 * по контрагентам и реестром, чтобы передать выгрузку наружу одним архивом.
 *
 * Формат .mjs (а не TS-CLI в server/src/cli) выбран сознательно: скрипт запускается в уже
 * собранном образе billhub-api без пересборки и деплоя — нужные зависимости (postgres.js,
 * @aws-sdk/client-s3) и env уже есть внутри контейнера.
 *
 * ТОЛЬКО ЧТЕНИЕ: в БД — SELECT, в S3 — GetObject/HeadObject. Ничего не изменяет.
 *
 * Запуск на VPS (из /opt/portals/billhub, после git pull). Монтируется весь каталог tools —
 * скрипт использует общие модули из tools/lib:
 *   mkdir -p /var/lib/billhub/export && chmod 700 /var/lib/billhub/export
 *   docker compose -f deploy/docker-compose.prod.yml -p billhub run --rm \
 *     --user "$(id -u):$(id -g)" \
 *     -v /opt/portals/billhub/deploy/tools:/app/tools:ro \
 *     -v /var/lib/billhub/export:/export \
 *     billhub-api node /app/tools/export-invoices.mjs --out /export --dry-run
 *
 * Флаги:
 *   --out <dir>           каталог выгрузки (обязателен)
 *   --dry-run             только реестр и подсчёт, без скачивания
 *   --include-rejected    включить отклонённые файлы (по умолчанию исключены)
 *   --include-deleted     включить файлы удалённых заявок (по умолчанию исключены)
 *   --from YYYY-MM-DD     нижняя граница по дате загрузки файла (включительно)
 *   --to YYYY-MM-DD       верхняя граница по дате загрузки файла (включительно)
 *   --doc-type <name>     тип документа (по умолчанию «Счет»)
 *   --concurrency N       параллельных скачиваний (по умолчанию 4)
 */
import { mkdir, writeFile } from 'node:fs/promises';
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
import { createS3Client, downloadAll } from './lib/s3-download.mjs';

/** Тип документа по умолчанию — в справочнике document_types он называется «Счет». */
const DEFAULT_DOC_TYPE = 'Счет';

/* ------------------------------- Аргументы -------------------------------- */

/** Разбор argv в объект опций. Неизвестный флаг — ошибка (защита от опечаток). */
function parseArgs(argv) {
  const opts = {
    out: '',
    dryRun: false,
    includeRejected: false,
    includeDeleted: false,
    from: null,
    to: null,
    docType: DEFAULT_DOC_TYPE,
    concurrency: 4,
  };

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
      case '--include-rejected':
        opts.includeRejected = true;
        break;
      case '--include-deleted':
        opts.includeDeleted = true;
        break;
      case '--from':
        opts.from = next();
        break;
      case '--to':
        opts.to = next();
        break;
      case '--doc-type':
        opts.docType = next();
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
  for (const [flag, value] of [['--from', opts.from], ['--to', opts.to]]) {
    if (value !== null && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw new Error(`${flag} ожидает дату в формате YYYY-MM-DD`);
    }
  }
  return opts;
}

/* --------------------------------- Выборка -------------------------------- */

/** Читает из БД список файлов счетов с метаданными заявки. */
async function fetchInvoiceFiles(sql, opts) {
  const conditions = [sql`dt.name = ${opts.docType}`];
  if (!opts.includeRejected) conditions.push(sql`f.is_rejected = false`);
  if (!opts.includeDeleted) conditions.push(sql`pr.is_deleted = false`);
  if (opts.from) conditions.push(sql`f.created_at >= ${opts.from}::date`);
  if (opts.to) conditions.push(sql`f.created_at < (${opts.to}::date + 1)`);

  let where = conditions[0];
  for (const condition of conditions.slice(1)) where = sql`${where} and ${condition}`;

  return sql`
    select
      f.id               as file_id,
      f.file_key         as file_key,
      f.file_name        as file_name,
      f.file_size        as file_size,
      f.created_at       as file_created_at,
      f.is_rejected      as is_rejected,
      pr.request_number  as request_number,
      pr.created_at      as request_created_at,
      pr.invoice_amount  as invoice_amount,
      pr.is_deleted      as request_deleted,
      cp.id              as counterparty_id,
      cp.name            as counterparty_name,
      cp.inn             as counterparty_inn,
      cs.name            as site_name,
      st.name            as status_name
    from payment_request_files f
      join document_types dt on dt.id = f.document_type_id
      join payment_requests pr on pr.id = f.payment_request_id
      join counterparties cp on cp.id = pr.counterparty_id
      left join construction_sites cs on cs.id = pr.site_id
      left join statuses st on st.id = pr.status_id
    where ${where}
    order by cp.name, pr.request_number, f.created_at
  `;
}

/** Достраивает для каждой строки путь внутри выгрузки (папка контрагента + уникальное имя). */
export function planLayout(rows) {
  const usedByFolder = new Map();

  // В справочнике встречаются разные юрлица с одинаковым названием — такие папки различаем по ИНН,
  // иначе файлы двух контрагентов смешались бы в одном каталоге.
  const idsByName = new Map();
  for (const row of rows) {
    const name = sanitizeFsName(row.counterparty_name, 'Без контрагента');
    if (!idsByName.has(name)) idsByName.set(name, new Set());
    idsByName.get(name).add(row.counterparty_id);
  }

  return rows.map((row) => {
    const baseFolder = sanitizeFsName(row.counterparty_name, 'Без контрагента');
    const folder =
      idsByName.get(baseFolder).size > 1 && row.counterparty_inn
        ? sanitizeFsName(`${baseFolder} (ИНН ${row.counterparty_inn})`, baseFolder)
        : baseFolder;
    if (!usedByFolder.has(folder)) usedByFolder.set(folder, new Set());

    const baseName = sanitizeFsName(row.file_name, `${row.file_id}.bin`);
    const numbered = row.request_number ? `${sanitizeFsName(row.request_number)}_${baseName}` : baseName;
    const fileName = uniqueName(sanitizeFsName(numbered, baseName), usedByFolder.get(folder));

    return { ...row, folder, fileName, relativePath: path.posix.join(folder, fileName) };
  });
}

/* ---------------------------------- Main ---------------------------------- */

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('Не задана переменная окружения DATABASE_URL');

  const bucket = process.env.S3_BUCKET;
  const endpoint = process.env.S3_ENDPOINT;
  const accessKeyId = process.env.S3_ACCESS_KEY;
  const secretAccessKey = process.env.S3_SECRET_KEY;
  if (!opts.dryRun && (!bucket || !endpoint || !accessKeyId || !secretAccessKey)) {
    throw new Error('Не заданы S3_ENDPOINT / S3_BUCKET / S3_ACCESS_KEY / S3_SECRET_KEY');
  }

  const sql = postgres(databaseUrl, { prepare: false, max: 2, idle_timeout: 20 });

  let items;
  try {
    console.log(`Выборка: тип документа «${opts.docType}»`);
    const rows = await fetchInvoiceFiles(sql, opts);
    items = planLayout(rows);
  } finally {
    await sql.end({ timeout: 5 });
  }

  const totalSize = items.reduce((sum, item) => sum + Number(item.file_size ?? 0), 0);
  const counterparties = new Set(items.map((item) => item.folder)).size;
  console.log(
    `Найдено файлов: ${items.length}, контрагентов: ${counterparties}, ожидаемый объём: ${formatSize(totalSize)}`,
  );

  if (items.length === 0) {
    console.log('Нечего выгружать — выборка пуста.');
    return;
  }

  await mkdir(opts.out, { recursive: true });

  const registryHeader = [
    'Контрагент',
    'ИНН',
    'Номер заявки',
    'Объект',
    'Статус заявки',
    'Сумма счёта',
    'Дата заявки',
    'Дата загрузки файла',
    'Имя файла',
    'Размер, байт',
    'Путь в выгрузке',
    'Отклонён',
    'Заявка удалена',
  ];
  const registryRows = items.map((item) => [
    item.counterparty_name,
    item.counterparty_inn,
    item.request_number,
    item.site_name,
    item.status_name,
    item.invoice_amount,
    csvDate(item.request_created_at),
    csvDate(item.file_created_at),
    item.file_name,
    item.file_size,
    item.relativePath,
    item.is_rejected ? 'да' : 'нет',
    item.request_deleted ? 'да' : 'нет',
  ]);
  await writeFile(path.join(opts.out, 'registry.csv'), csvContent(registryHeader, registryRows), 'utf8');
  console.log(`Реестр записан: ${path.join(opts.out, 'registry.csv')}`);

  if (opts.dryRun) {
    console.log('Режим --dry-run: файлы не скачивались.');
    return;
  }

  const s3 = createS3Client();

  console.log(`Скачивание в ${opts.out} (параллельно: ${opts.concurrency})...`);
  const result = await downloadAll(s3, bucket, items, opts.out, opts.concurrency, createProgressLogger(50));

  if (result.errors.length > 0) {
    const errorsPath = path.join(opts.out, 'errors.csv');
    await writeFile(
      errorsPath,
      csvContent(
        ['Контрагент', 'Номер заявки', 'Имя файла', 'Ключ S3', 'Ошибка'],
        result.errors.map(({ item, message }) => [
          item.counterparty_name,
          item.request_number,
          item.file_name,
          item.file_key,
          message,
        ]),
      ),
      'utf8',
    );
    console.log(`Ошибки записаны: ${errorsPath}`);
  }

  console.log(
    `Готово. Скачано: ${result.downloaded}, пропущено (уже были): ${result.skipped}, ` +
      `ошибок: ${result.errors.length}, объём: ${formatSize(result.bytes)}`,
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
