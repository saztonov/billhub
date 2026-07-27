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
 * Запуск на VPS (из /opt/portals/billhub, после git pull):
 *   mkdir -p /var/lib/billhub/export && chmod 700 /var/lib/billhub/export
 *   docker compose -f deploy/docker-compose.prod.yml -p billhub run --rm \
 *     --user "$(id -u):$(id -g)" \
 *     -v /opt/portals/billhub/deploy/tools/export-invoices.mjs:/app/export-invoices.mjs:ro \
 *     -v /var/lib/billhub/export:/export \
 *     billhub-api node /app/export-invoices.mjs --out /export --dry-run
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
import { createWriteStream } from 'node:fs';
import { mkdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { pathToFileURL } from 'node:url';
import postgres from 'postgres';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';

/** Тип документа по умолчанию — в справочнике document_types он называется «Счет». */
const DEFAULT_DOC_TYPE = 'Счет';
/** Максимальная длина имени файла/папки (запас до лимита ext4 в 255 байт при кириллице). */
const MAX_NAME_LENGTH = 100;
/** Число попыток скачивания одного объекта. */
const MAX_ATTEMPTS = 3;

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

/* ------------------------------ Имена файлов ------------------------------ */

/**
 * Приводит строку к безопасному имени файла/папки, сохраняя кириллицу.
 * Убирает обход каталогов, разделители пути, управляющие и запрещённые в Windows символы.
 */
export function sanitizeFsName(name, fallback = 'file') {
  const cleaned = String(name ?? '')
    // Серии точек схлопываем в одну: и обход каталогов исключён, и расширение не склеивается
    // с именем (в БД встречаются имена вида «счет от 20 мая 2026 г..pdf»)
    .replace(/\.{2,}/g, '.')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    // Кавычки в названиях («ООО "Ромашка"») просто убираем — подчёркивания вместо них читаются хуже
    .replace(/["']/g, '')
    .replace(/[\\/:*?<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/^[\s._]+|[\s.]+$/g, '')
    .trim();

  if (!cleaned) return fallback;
  if (cleaned.length <= MAX_NAME_LENGTH) return cleaned;

  // Длинное имя укорачиваем, сохраняя расширение
  const ext = path.extname(cleaned).slice(0, 10);
  const base = cleaned.slice(0, MAX_NAME_LENGTH - ext.length).replace(/[\s.]+$/, '');
  return `${base || fallback}${ext}`;
}

/** Уникализирует имя внутри каталога суффиксом _2, _3, ... (в БД встречаются дубли ключей). */
function uniqueName(name, usedNames) {
  if (!usedNames.has(name)) {
    usedNames.add(name);
    return name;
  }
  const ext = path.extname(name);
  const base = name.slice(0, name.length - ext.length);
  for (let n = 2; ; n += 1) {
    const candidate = `${base}_${n}${ext}`;
    if (!usedNames.has(candidate)) {
      usedNames.add(candidate);
      return candidate;
    }
  }
}

/* ----------------------------------- CSV ---------------------------------- */

/** Экранирование значения для CSV с разделителем «;». Хвостовые пробелы из БД срезаются. */
function csvValue(value) {
  if (value === null || value === undefined) return '';
  const text = String(value).trim();
  return /[";\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Строка CSV из массива значений. */
function csvRow(values) {
  return values.map(csvValue).join(';');
}

/** CSV-файл целиком: BOM + CRLF, чтобы Excel открыл в UTF-8 без плясок. */
export function csvContent(header, rows) {
  return `﻿${[csvRow(header), ...rows.map(csvRow)].join('\r\n')}\r\n`;
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

/* ------------------------------- Скачивание ------------------------------- */

/** Скачивает один объект S3 во временный .part и переименовывает после успеха. */
export async function downloadOne(s3, bucket, item, outDir) {
  const targetPath = path.join(outDir, item.folder, item.fileName);
  const tempPath = `${targetPath}.part`;

  // Повторный запуск не перекачивает уже готовые файлы совпадающего размера
  if (item.file_size) {
    try {
      const existing = await stat(targetPath);
      if (existing.size === Number(item.file_size)) return { skipped: true, size: existing.size };
    } catch {
      // файла нет — качаем
    }
  }

  let lastError;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: item.file_key }));
      if (!response.Body) throw new Error('S3 вернул пустой Body');
      await pipeline(response.Body, createWriteStream(tempPath));
      const written = await stat(tempPath);
      await rename(tempPath, targetPath);
      return { skipped: false, size: written.size };
    } catch (error) {
      lastError = error;
      await unlink(tempPath).catch(() => {});
      const notFound = error?.name === 'NoSuchKey' || error?.$metadata?.httpStatusCode === 404;
      if (notFound || attempt === MAX_ATTEMPTS) break;
      await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
    }
  }
  throw lastError ?? new Error('Неизвестная ошибка скачивания');
}

/** Пул воркеров с ограниченным параллелизмом; ошибки складываются в errors, прогон не прерывается. */
export async function downloadAll(s3, bucket, items, outDir, concurrency, onProgress) {
  const errors = [];
  let downloaded = 0;
  let skipped = 0;
  let bytes = 0;
  let cursor = 0;

  const worker = async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      const item = items[index];
      try {
        const result = await downloadOne(s3, bucket, item, outDir);
        bytes += result.size;
        if (result.skipped) skipped += 1;
        else downloaded += 1;
      } catch (error) {
        errors.push({ item, message: error?.message ?? String(error) });
      }
      onProgress(downloaded + skipped + errors.length, items.length);
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return { downloaded, skipped, bytes, errors };
}

/* ---------------------------------- Main ---------------------------------- */

/** Человекочитаемый размер. */
function formatSize(bytes) {
  const mb = bytes / 1024 / 1024;
  return mb >= 1024 ? `${(mb / 1024).toFixed(2)} ГБ` : `${mb.toFixed(1)} МБ`;
}

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
    item.request_created_at ? new Date(item.request_created_at).toISOString().slice(0, 10) : '',
    item.file_created_at ? new Date(item.file_created_at).toISOString().slice(0, 10) : '',
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

  for (const folder of new Set(items.map((item) => item.folder))) {
    await mkdir(path.join(opts.out, folder), { recursive: true });
  }

  const s3 = new S3Client({
    endpoint,
    region: process.env.S3_REGION || 'ru-central-1',
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true,
    maxAttempts: 5,
  });

  console.log(`Скачивание в ${opts.out} (параллельно: ${opts.concurrency})...`);
  let lastReported = 0;
  const result = await downloadAll(s3, bucket, items, opts.out, opts.concurrency, (done, total) => {
    if (done - lastReported >= 50 || done === total) {
      lastReported = done;
      console.log(`  ${done}/${total}`);
    }
  });

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
