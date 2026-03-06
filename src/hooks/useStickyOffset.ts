import { createContext, useContext, useState, useEffect, useRef, type RefObject } from 'react'

export const StickyOffsetContext = createContext(0)

/** Возвращает текущий offset для sticky-заголовков таблиц */
export const useStickyOffset = () => useContext(StickyOffsetContext)

/** Измеряет высоту элемента по ref и возвращает offset + ref */
export function useStickyHeaderRef(): { stickyRef: RefObject<HTMLDivElement | null>; stickyOffset: number } {
  const stickyRef = useRef<HTMLDivElement>(null)
  const [stickyOffset, setStickyOffset] = useState(0)

  useEffect(() => {
    const el = stickyRef.current
    if (!el) return
    const observer = new ResizeObserver(() => {
      setStickyOffset(el.offsetHeight)
    })
    observer.observe(el)
    setStickyOffset(el.offsetHeight)
    return () => observer.disconnect()
  }, [])

  return { stickyRef, stickyOffset }
}

/** Возвращает контейнер скролла для Ant Design Table sticky */
export function getScrollContainer(): HTMLElement {
  return document.getElementById('main-content') || document.documentElement
}
