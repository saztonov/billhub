/**
 * Чистые функции имён для выгрузки в SIGNAL: папки поставщиков, имена файлов,
 * сопоставление существующих папок по нормализованному имени.
 */

/** Символы, недопустимые в именах файлов/папок (Windows-совместимо) и управляющие */
// eslint-disable-next-line no-control-regex
const FORBIDDEN_CHARS = /[\\/:*?"<>|\u0000-\u001f]/g;
/** Кавычки всех видов — в SIGNAL папки поставщиков названы без кавычек */
const QUOTES = /["'`«»„“”‟‘’]/g;
/** Максимальная длина сегмента пути */
const MAX_SEGMENT_LENGTH = 150;

/** Схлопывание пробелов и обрезка */
function collapse(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/** Название организации в стиле SIGNAL: без кавычек, без лишних пробелов (ООО "ЭК "ТЕМА" → ООО ЭК ТЕМА) */
export function normalizeOrgName(name: string): string {
  return collapse(name.replace(QUOTES, ' '));
}

/** Безопасный сегмент пути: без запрещённых символов, точек/пробелов в конце, ограниченной длины */
export function sanitizeSegment(name: string, fallback = 'Без названия'): string {
  let value = collapse(name.replace(FORBIDDEN_CHARS, '_'));
  if (value.length > MAX_SEGMENT_LENGTH) value = value.slice(0, MAX_SEGMENT_LENGTH).trim();
  value = value.replace(/[. ]+$/, '');
  return value.length > 0 ? value : fallback;
}

/** Ключ сравнения имён папок: регистр, ё/е, кавычки и пробелы не важны */
export function folderKey(name: string): string {
  return collapse(name.replace(QUOTES, ' ').toLowerCase().replace(/ё/g, 'е'));
}

/** Папка «12. Снабжение» (номер раздела может отличаться или отсутствовать) */
export function isSupplyFolder(name: string): boolean {
  return folderKey(name).replace(/^\d+\s*[.)]?\s*/, '') === 'снабжение';
}

/** Название папки со счетами внутри «Снабжения» */
export const INVOICES_FOLDER_NAME = 'Счета';

/** Поставщик для построения имени папки */
export interface SupplierRef {
  id: string;
  name: string;
  inn: string;
}

/**
 * Имена папок поставщиков в пределах проекта. Совпадающие после нормализации названия
 * разных поставщиков различаются суффиксом «(ИНН …)».
 */
export function supplierFolderNames(suppliers: readonly SupplierRef[]): Map<string, string> {
  const unique = new Map<string, SupplierRef>();
  for (const s of suppliers) unique.set(s.id, s);

  const byKey = new Map<string, SupplierRef[]>();
  for (const s of unique.values()) {
    const key = folderKey(normalizeOrgName(s.name));
    byKey.set(key, [...(byKey.get(key) ?? []), s]);
  }

  const result = new Map<string, string>();
  for (const group of byKey.values()) {
    for (const s of group) {
      const base = sanitizeSegment(normalizeOrgName(s.name));
      const name = group.length > 1 && s.inn ? `${base} (ИНН ${s.inn})` : base;
      result.set(s.id, sanitizeSegment(name));
    }
  }
  return result;
}

/** Разделение имени файла на основу и расширение (расширение — с точкой, ≤10 символов) */
function splitExtension(name: string): { stem: string; ext: string } {
  const match = /^(.*?)(\.[^.\s]{1,10})$/.exec(name);
  return match && match[1] ? { stem: match[1], ext: match[2]! } : { stem: name, ext: '' };
}

/** Имя файла в SIGNAL: «<№ заявки>_<исходное имя>» */
export function buildFileName(requestNumber: string, fileName: string): string {
  const safe = sanitizeSegment(fileName, 'file');
  const prefix = sanitizeSegment(requestNumber, '');
  return prefix ? `${prefix}_${safe}` : safe;
}

/**
 * Уникальное имя среди занятых (сравнение без учёта регистра): «имя (2).pdf», «имя (3).pdf»…
 * Найденное имя добавляется в taken.
 */
export function uniqueName(name: string, taken: Set<string>): string {
  let candidate = name;
  if (taken.has(candidate.toLowerCase())) {
    const { stem, ext } = splitExtension(name);
    for (let n = 2; ; n++) {
      candidate = `${stem} (${n})${ext}`;
      if (!taken.has(candidate.toLowerCase())) break;
    }
  }
  taken.add(candidate.toLowerCase());
  return candidate;
}

/** Простое определение MIME по расширению — если в БД тип не сохранён */
export function guessMimeType(fileName: string): string {
  const ext = splitExtension(fileName).ext.toLowerCase();
  const map: Record<string, string> = {
    '.pdf': 'application/pdf',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.tif': 'image/tiff',
    '.tiff': 'image/tiff',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.zip': 'application/zip',
  };
  return map[ext] ?? 'application/octet-stream';
}
