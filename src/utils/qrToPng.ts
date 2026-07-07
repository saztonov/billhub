/**
 * Конвертация QR-кода письма PayHub из SVG data-URL в PNG data-URL через canvas.
 * PayHub отдаёт QR как SVG (data:image/svg+xml;base64,...); PNG удобнее вставлять
 * в документы (Word/PDF). При ошибке рисования — вызывающий код падает на исходный SVG.
 */

/** Размер стороны PNG (QR — вектор, масштабируется без потери качества). */
const DEFAULT_PNG_SIZE = 512

/** SVG data-URL -> PNG data-URL. Бросает ошибку, если canvas недоступен/загрязнён. */
export async function svgDataUrlToPngDataUrl(
  svgDataUrl: string,
  size = DEFAULT_PNG_SIZE,
): Promise<string> {
  const img = new Image()
  img.decoding = 'async'
  const loaded = new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = () => reject(new Error('Не удалось загрузить SVG QR-кода'))
  })
  img.src = svgDataUrl
  await loaded

  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D-контекст недоступен')
  // Белая подложка — QR может быть без фона (прозрачный SVG).
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, size, size)
  ctx.drawImage(img, 0, 0, size, size)
  return canvas.toDataURL('image/png')
}

/** data-URL (base64 или percent-encoded) -> File для загрузки в S3. */
export function dataUrlToFile(dataUrl: string, fileName: string): File {
  const commaIdx = dataUrl.indexOf(',')
  const header = dataUrl.slice(0, commaIdx)
  const data = dataUrl.slice(commaIdx + 1)
  const mime = header.match(/data:([^;]+)/)?.[1] ?? 'application/octet-stream'
  let bytes: Uint8Array<ArrayBuffer>
  if (header.includes('base64')) {
    const binary = atob(data)
    bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  } else {
    bytes = new Uint8Array(new TextEncoder().encode(decodeURIComponent(data)))
  }
  return new File([bytes], fileName, { type: mime })
}

/** Скачивание data-URL как файла (клик по временной ссылке). */
export function downloadDataUrl(dataUrl: string, fileName: string): void {
  const a = document.createElement('a')
  a.href = dataUrl
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
}
