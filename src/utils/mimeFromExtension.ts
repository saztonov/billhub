// Определение MIME-типа по расширению файла
// Используется в местах, где mime не сохранён в БД (например, dpFileKey/dpFileName)

const EXTENSION_TO_MIME: Record<string, string> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  svg: 'image/svg+xml',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
}

export function getMimeFromFileName(fileName: string | null | undefined): string | null {
  if (!fileName) return null
  const idx = fileName.lastIndexOf('.')
  if (idx < 0 || idx === fileName.length - 1) return null
  const ext = fileName.slice(idx + 1).toLowerCase()
  return EXTENSION_TO_MIME[ext] ?? null
}

export function isImageMime(mime: string | null): boolean {
  return !!mime && mime.startsWith('image/')
}

export function isPdfMime(mime: string | null): boolean {
  return mime === 'application/pdf'
}

export function isExcelMime(mime: string | null): boolean {
  return mime === 'application/vnd.ms-excel'
    || mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
}

export function isWordMime(mime: string | null): boolean {
  return mime === 'application/msword'
    || mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
}

export function isOfficeMime(mime: string | null): boolean {
  return isExcelMime(mime) || isWordMime(mime)
}
