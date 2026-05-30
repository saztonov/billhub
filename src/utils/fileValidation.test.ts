import { describe, it, expect } from 'vitest'
import { checkFileMagicBytes } from './fileValidation'

/** Создаёт File с заданным байтовым заголовком и расширением */
function makeFile(bytes: number[], name: string): File {
  const buffer = new Uint8Array(bytes)
  return new File([buffer], name, { type: 'application/octet-stream' })
}

describe('checkFileMagicBytes', () => {
  it('PDF: валидный заголовок %PDF', async () => {
    const file = makeFile([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34], 'doc.pdf')
    expect(await checkFileMagicBytes(file)).toBe(true)
  })

  it('PDF: невалидный заголовок — false', async () => {
    const file = makeFile([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00], 'fake.pdf')
    expect(await checkFileMagicBytes(file)).toBe(false)
  })

  it('JPEG: валидный FF D8 FF', async () => {
    const file = makeFile([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x00, 0x00, 0x00], 'photo.jpg')
    expect(await checkFileMagicBytes(file)).toBe(true)
  })

  it('JPEG: то же расширение .jpeg', async () => {
    const file = makeFile([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x00, 0x00, 0x00], 'photo.jpeg')
    expect(await checkFileMagicBytes(file)).toBe(true)
  })

  it('PNG: валидный 89 50 4E 47', async () => {
    const file = makeFile([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'image.png')
    expect(await checkFileMagicBytes(file)).toBe(true)
  })

  it('DOCX/XLSX: валидный ZIP-заголовок PK', async () => {
    const docx = makeFile([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00], 'doc.docx')
    expect(await checkFileMagicBytes(docx)).toBe(true)
    const xlsx = makeFile([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00], 'sheet.xlsx')
    expect(await checkFileMagicBytes(xlsx)).toBe(true)
  })

  it('Старый DOC/XLS: валидный OLE D0 CF 11 E0', async () => {
    const doc = makeFile([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1], 'old.doc')
    expect(await checkFileMagicBytes(doc)).toBe(true)
  })

  it('Неизвестное расширение — пропускает проверку (true)', async () => {
    const file = makeFile([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07], 'data.xyz')
    expect(await checkFileMagicBytes(file)).toBe(true)
  })

  it('Без расширения — пропускает проверку', async () => {
    const file = makeFile([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07], 'README')
    expect(await checkFileMagicBytes(file)).toBe(true)
  })

  it('TIFF Little-endian', async () => {
    const file = makeFile([0x49, 0x49, 0x2a, 0x00, 0x00, 0x00, 0x00, 0x00], 'scan.tiff')
    expect(await checkFileMagicBytes(file)).toBe(true)
  })

  it('TIFF Big-endian — тот же экспорт .tif', async () => {
    const file = makeFile([0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x00], 'scan.tif')
    expect(await checkFileMagicBytes(file)).toBe(true)
  })

  it('PDF с ZIP-заголовком — false (расширение не совпадает с сигнатурой)', async () => {
    const file = makeFile([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x00, 0x00], 'fake.pdf')
    expect(await checkFileMagicBytes(file)).toBe(false)
  })

  it('Учитывает регистр расширения', async () => {
    const file = makeFile([0x25, 0x50, 0x44, 0x46, 0x00, 0x00, 0x00, 0x00], 'doc.PDF')
    expect(await checkFileMagicBytes(file)).toBe(true)
  })
})
