import { describe, it, expect, vi, afterEach } from 'vitest'
import { svgDataUrlToPngDataUrl, downloadDataUrl } from './qrToPng'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('svgDataUrlToPngDataUrl', () => {
  it('отклоняется при ошибке загрузки SVG (вызывающий падает на SVG-фолбэк)', async () => {
    // Image в jsdom не грузит data-URL — эмулируем ошибку загрузки.
    class FailImage {
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      decoding = ''
      set src(_v: string) {
        queueMicrotask(() => this.onerror?.())
      }
    }
    vi.stubGlobal('Image', FailImage)
    await expect(svgDataUrlToPngDataUrl('data:image/svg+xml;base64,QQ==')).rejects.toThrow()
  })
})

describe('downloadDataUrl', () => {
  it('кликает по временной ссылке с именем файла', () => {
    const clicked: HTMLAnchorElement[] = []
    const orig = HTMLAnchorElement.prototype.click
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      clicked.push(this)
    }
    try {
      downloadDataUrl('data:image/png;base64,AAAA', 'qr.png')
    } finally {
      HTMLAnchorElement.prototype.click = orig
    }
    expect(clicked).toHaveLength(1)
    expect(clicked[0].download).toBe('qr.png')
    expect(clicked[0].href).toContain('data:image/png')
  })
})
