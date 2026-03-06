import { useState, useEffect, useRef, useCallback, type RefObject } from 'react'

/**
 * Хук для динамического расчёта scroll.y таблицы Ant Design.
 * Измеряет доступную высоту контейнера через ResizeObserver,
 * вычитает высоту thead и пагинации (включая borders).
 * Если paginationRef не привязан — автоматически ищет .ant-table-pagination в контейнере.
 */
export function useTableScrollY(deps: unknown[] = []): {
  containerRef: RefObject<HTMLDivElement | null>
  paginationRef: RefObject<HTMLDivElement | null>
  scrollY: number | undefined
} {
  const containerRef = useRef<HTMLDivElement>(null)
  const paginationRef = useRef<HTMLDivElement>(null)
  const [scrollY, setScrollY] = useState<number | undefined>(undefined)

  const calculate = useCallback(() => {
    const container = containerRef.current
    if (!container) return

    const containerHeight = container.clientHeight
    const thead = container.querySelector('.ant-table-thead')
    const theadHeight = thead ? thead.getBoundingClientRect().height : 55

    // Пагинация: если есть внешний ref — берём его, иначе ищем встроенную Ant pagination
    let paginationHeight = 0
    if (paginationRef.current) {
      paginationHeight = paginationRef.current.offsetHeight
    } else {
      const builtInPagination = container.querySelector('.ant-table-pagination') as HTMLElement | null
      if (builtInPagination) {
        const style = getComputedStyle(builtInPagination)
        paginationHeight = builtInPagination.offsetHeight
          + parseFloat(style.marginTop || '0')
          + parseFloat(style.marginBottom || '0')
      }
    }

    // border таблицы (1px top + 1px bottom)
    const borders = 2
    const newScrollY = containerHeight - theadHeight - paginationHeight - borders
    setScrollY(newScrollY > 100 ? newScrollY : 100)
  }, [])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const observer = new ResizeObserver(() => calculate())
    observer.observe(container)
    calculate()
    return () => observer.disconnect()
  }, [calculate])

  // Пересчёт при изменении зависимостей (данные, фильтры)
  useEffect(() => {
    const timer = setTimeout(calculate, 50)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return { containerRef, paginationRef, scrollY }
}
