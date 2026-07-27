/**
 * export-common — общие утилиты разовых выгрузок файлов из BillHub.
 *
 * Используется скриптами deploy/tools/export-*.mjs: санитизация имён под файловую систему,
 * CSV под Excel, форматирование прогресса. Только node-встроенные модули — файл импортируется
 * и проверяется локально, без установленных зависимостей сервера (S3-часть — в s3-download.mjs).
 */
import path from 'node:path';

/** Максимальная длина имени файла/папки (запас до лимита ext4 в 255 байт при кириллице). */
export const MAX_NAME_LENGTH = 100;
/** Управляющие символы, недопустимые в именах файлов. */
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;

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
    .replace(CONTROL_CHARS, '')
    // Кавычки в названиях («ООО "Ромашка"») просто убираем — подчёркивания вместо них читаются хуже
    .replace(/["'«»]/g, '')
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
export function uniqueName(name, usedNames) {
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

/** Дата из БД в вид YYYY-MM-DD для реестра (пустая строка, если значения нет). */
export function csvDate(value) {
  return value ? new Date(value).toISOString().slice(0, 10) : '';
}

/* --------------------------------- Прочее --------------------------------- */

/** Человекочитаемый размер. */
export function formatSize(bytes) {
  const mb = bytes / 1024 / 1024;
  return mb >= 1024 ? `${(mb / 1024).toFixed(2)} ГБ` : `${mb.toFixed(1)} МБ`;
}

/** Печать прогресса не чаще, чем раз в `step` файлов (и обязательно на финише). */
export function createProgressLogger(step = 25) {
  let lastReported = 0;
  return (done, total) => {
    if (done - lastReported >= step || done === total) {
      lastReported = done;
      console.log(`  ${done}/${total}`);
    }
  };
}
