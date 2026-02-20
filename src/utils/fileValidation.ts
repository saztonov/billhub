/**
 * Проверка типа файла по magic bytes (сигнатуре).
 * Дополнение к проверке по расширению/MIME.
 */

interface MagicSignature {
  offset: number
  bytes: number[]
}

const SIGNATURES: Record<string, MagicSignature[]> = {
  // PDF: %PDF
  pdf: [{ offset: 0, bytes: [0x25, 0x50, 0x44, 0x46] }],
  // JPEG: FF D8 FF
  jpeg: [{ offset: 0, bytes: [0xFF, 0xD8, 0xFF] }],
  // PNG: 89 50 4E 47
  png: [{ offset: 0, bytes: [0x89, 0x50, 0x4E, 0x47] }],
  // ZIP/DOCX/XLSX: PK (50 4B 03 04)
  zip: [{ offset: 0, bytes: [0x50, 0x4B, 0x03, 0x04] }],
  // TIFF Little-endian: 49 49 2A 00
  tiff_le: [{ offset: 0, bytes: [0x49, 0x49, 0x2A, 0x00] }],
  // TIFF Big-endian: 4D 4D 00 2A
  tiff_be: [{ offset: 0, bytes: [0x4D, 0x4D, 0x00, 0x2A] }],
  // BMP: BM (42 4D)
  bmp: [{ offset: 0, bytes: [0x42, 0x4D] }],
  // MS Office (старые .doc, .xls): D0 CF 11 E0
  ole: [{ offset: 0, bytes: [0xD0, 0xCF, 0x11, 0xE0] }],
}

// Маппинг расширений к допустимым типам сигнатур
const EXT_TO_SIGNATURES: Record<string, string[]> = {
  pdf: ['pdf'],
  jpg: ['jpeg'],
  jpeg: ['jpeg'],
  png: ['png'],
  tiff: ['tiff_le', 'tiff_be'],
  tif: ['tiff_le', 'tiff_be'],
  bmp: ['bmp'],
  doc: ['ole'],
  xls: ['ole'],
  docx: ['zip'],
  xlsx: ['zip'],
}

/** Максимальное количество байт для чтения заголовка */
const MAX_HEADER_SIZE = 8

function readFileHeader(file: File): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      resolve(new Uint8Array(reader.result as ArrayBuffer))
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsArrayBuffer(file.slice(0, MAX_HEADER_SIZE))
  })
}

function matchesSignature(header: Uint8Array, sig: MagicSignature): boolean {
  for (let i = 0; i < sig.bytes.length; i++) {
    if (header[sig.offset + i] !== sig.bytes[i]) return false
  }
  return true
}

/**
 * Проверяет, соответствует ли содержимое файла его расширению по magic bytes.
 * Возвращает true если файл валиден, false если сигнатура не совпадает.
 * Для неизвестных расширений возвращает true (пропускает проверку).
 */
export async function checkFileMagicBytes(file: File): Promise<boolean> {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  const allowedSigNames = EXT_TO_SIGNATURES[ext]

  // Неизвестное расширение — пропускаем проверку
  if (!allowedSigNames) return true

  try {
    const header = await readFileHeader(file)

    // Проверяем, совпадает ли хотя бы одна допустимая сигнатура
    for (const sigName of allowedSigNames) {
      const sigs = SIGNATURES[sigName]
      if (sigs) {
        for (const sig of sigs) {
          if (matchesSignature(header, sig)) return true
        }
      }
    }

    return false
  } catch {
    // При ошибке чтения — пропускаем проверку
    return true
  }
}
