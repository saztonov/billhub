/** Динамический favicon с badge при наличии непрочитанных уведомлений */

const ORIGINAL_HREF = '/favicon.svg'
const ICON_SIZE = 64

let currentHasNotifications = false
let originalImage: HTMLImageElement | null = null

/** Загружает оригинальную SVG-иконку как Image (один раз) */
function loadOriginalIcon(): Promise<HTMLImageElement> {
  if (originalImage) return Promise.resolve(originalImage)
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      originalImage = img
      resolve(img)
    }
    img.onerror = reject
    img.src = ORIGINAL_HREF
  })
}

/** Рисует badge (красный кружок с "!") поверх иконки и возвращает data URL */
async function renderBadgeFavicon(): Promise<string> {
  const img = await loadOriginalIcon()
  const canvas = document.createElement('canvas')
  canvas.width = ICON_SIZE
  canvas.height = ICON_SIZE
  const ctx = canvas.getContext('2d')!

  // Рисуем оригинальную иконку
  ctx.drawImage(img, 0, 0, ICON_SIZE, ICON_SIZE)

  // Красный кружок в правом верхнем углу
  const badgeRadius = 12
  const cx = ICON_SIZE - badgeRadius - 1
  const cy = badgeRadius + 1

  ctx.beginPath()
  ctx.arc(cx, cy, badgeRadius, 0, Math.PI * 2)
  ctx.fillStyle = '#ff4d4f'
  ctx.fill()
  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = 2
  ctx.stroke()

  // Восклицательный знак
  ctx.fillStyle = '#ffffff'
  ctx.font = 'bold 16px sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('!', cx, cy)

  return canvas.toDataURL('image/png')
}

/** Устанавливает href у <link rel="icon"> */
function setFaviconHref(href: string) {
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
  if (!link) {
    link = document.createElement('link')
    link.rel = 'icon'
    document.head.appendChild(link)
  }
  link.type = href === ORIGINAL_HREF ? 'image/svg+xml' : 'image/png'
  link.href = href
}

/** Обновляет favicon в зависимости от количества непрочитанных уведомлений */
export async function updateFaviconBadge(unreadCount: number): Promise<void> {
  const hasNotifications = unreadCount > 0

  // Не перерисовываем, если состояние не изменилось
  if (hasNotifications === currentHasNotifications) return
  currentHasNotifications = hasNotifications

  if (hasNotifications) {
    try {
      const dataUrl = await renderBadgeFavicon()
      setFaviconHref(dataUrl)
    } catch {
      // При ошибке рендера — не меняем favicon
    }
  } else {
    setFaviconHref(ORIGINAL_HREF)
  }
}
