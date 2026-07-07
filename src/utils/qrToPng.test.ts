import { describe, it, expect, vi, afterEach } from 'vitest'
import { svgDataUrlToPngDataUrl, downloadDataUrl, dataUrlToFile } from './qrToPng'

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

describe('dataUrlToFile', () => {
  it('декодирует base64 data-URL в File с корректным MIME и содержимым', async () => {
    // atob('QUI=') === 'AB'
    const file = dataUrlToFile('data:image/png;base64,QUI=', 'QR_Д56.png')
    expect(file.name).toBe('QR_Д56.png')
    expect(file.type).toBe('image/png')
    expect(file.size).toBe(2)
    expect(await file.text()).toBe('AB')
  })

  it('декодирует percent-encoded (не base64) SVG data-URL', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"/>'
    const file = dataUrlToFile(`data:image/svg+xml,${encodeURIComponent(svg)}`, 'QR.svg')
    expect(file.type).toBe('image/svg+xml')
    expect(await file.text()).toBe(svg)
  })
})
