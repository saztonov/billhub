/**
 * approved-invoices-layout — раскладка архива и реестр для export-approved-invoices.mjs.
 *
 * Вынесено отдельно от скрипта, потому что тот импортирует postgres.js и @aws-sdk/client-s3,
 * которые есть только в образе billhub-api. Здесь — только node-встроенные модули и
 * export-common.mjs: модуль импортируется и проверяется локально на реальной выборке.
 */
import { csvContent, csvDate, sanitizeFsName, uniqueName } from './export-common.mjs';

/** Папка для заявок без поставщика. */
export const NO_SUPPLIER_FOLDER = 'Без поставщика';

/**
 * Достраивает для каждой строки путь внутри архива: {поставщик}/{номер заявки}_{имя файла}.
 * Строки ожидаются уже отсортированными — порядок сохраняется (он же порядок в архиве).
 */
export function planLayout(rows) {
  const usedByFolder = new Map();

  // В справочнике поставщиков встречаются разные юрлица с одинаковым названием — такие папки
  // различаем по ИНН, иначе счета двух поставщиков смешались бы в одном каталоге
  const idsByName = new Map();
  for (const row of rows) {
    const name = sanitizeFsName(row.supplier_name, NO_SUPPLIER_FOLDER);
    if (!idsByName.has(name)) idsByName.set(name, new Set());
    idsByName.get(name).add(row.supplier_id ?? null);
  }

  return rows.map((row) => {
    const baseFolder = sanitizeFsName(row.supplier_name, NO_SUPPLIER_FOLDER);
    const inn = String(row.supplier_inn ?? '').trim();
    const folder =
      idsByName.get(baseFolder).size > 1 && inn
        ? sanitizeFsName(`${baseFolder} (ИНН ${inn})`, baseFolder)
        : baseFolder;
    if (!usedByFolder.has(folder)) usedByFolder.set(folder, new Set());

    // Номер заявки в имени связывает файл со строкой реестра и разводит одноимённые счета
    // разных заявок одного поставщика
    const baseName = sanitizeFsName(row.file_name, `${row.file_id}.bin`);
    const numbered = row.request_number ? `${sanitizeFsName(row.request_number)}_${baseName}` : baseName;
    const fileName = uniqueName(sanitizeFsName(numbered, baseName), usedByFolder.get(folder));

    return { ...row, folder, fileName, relativePath: `${folder}/${fileName}` };
  });
}

const REGISTRY_HEADER = [
  'Поставщик',
  'ИНН поставщика',
  'Номер заявки',
  'Дата заявки',
  'Дата согласования',
  'Сумма счёта',
  'Статус оплаты',
  'Имя файла',
  'Дата загрузки файла',
  'Размер, байт',
  'Путь в архиве',
  'В архиве',
];

/** Реестр файлов архива. failed = null в режиме --dry-run (скачивания не было). */
export function buildRegistryCsv(items, failed) {
  return csvContent(
    REGISTRY_HEADER,
    items.map((item) => [
      item.supplier_name ?? NO_SUPPLIER_FOLDER,
      item.supplier_inn,
      item.request_number,
      csvDate(item.request_created_at),
      csvDate(item.request_approved_at),
      item.invoice_amount,
      item.paid_status_name,
      item.file_name,
      csvDate(item.file_created_at),
      item.file_size,
      item.relativePath,
      failed === null ? '—' : failed.has(item.relativePath) ? 'нет' : 'да',
    ]),
  );
}

/** Имя архива: Счета_{контрагент}_{объект}_{дата}.zip, пробелы заменены на «_» для удобства scp. */
export function buildArchiveName(counterpartyName, siteName, date) {
  const parts = [
    'Счета',
    sanitizeFsName(counterpartyName, 'контрагент'),
    sanitizeFsName(siteName, 'объект'),
    date.toISOString().slice(0, 10),
  ];
  return `${sanitizeFsName(parts.join('_'), 'Счета').replace(/\s+/g, '_')}.zip`;
}
