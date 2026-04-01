import { useState, useCallback } from 'react'

export interface ColumnConfig {
  hiddenColumns: string[]
  columnOrder: string[]
}

const STORAGE_KEY = 'billhub_column_config'

function loadConfig(): ColumnConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      return {
        hiddenColumns: Array.isArray(parsed.hiddenColumns) ? parsed.hiddenColumns : [],
        columnOrder: Array.isArray(parsed.columnOrder) ? parsed.columnOrder : [],
      }
    }
  } catch { /* невалидные данные — используем дефолт */ }
  return { hiddenColumns: [], columnOrder: [] }
}

function saveConfig(config: ColumnConfig): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
}

/**
 * Хук для управления видимостью и порядком столбцов таблицы.
 * Персистентность через localStorage.
 */
export function useColumnConfig() {
  const [config, setConfigState] = useState<ColumnConfig>(loadConfig)

  const setConfig = useCallback((updater: ColumnConfig | ((prev: ColumnConfig) => ColumnConfig)) => {
    setConfigState((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater
      saveConfig(next)
      return next
    })
  }, [])

  const resetConfig = useCallback(() => {
    const empty: ColumnConfig = { hiddenColumns: [], columnOrder: [] }
    saveConfig(empty)
    setConfigState(empty)
  }, [])

  return { config, setConfig, resetConfig }
}

/**
 * Применяет пользовательский конфиг к массиву столбцов:
 * — убирает скрытые, переупорядочивает по columnOrder,
 * — столбец "actions" всегда последний.
 */
export function applyColumnConfig<T extends { key?: string }>(
  columns: T[],
  config: ColumnConfig,
): T[] {
  // Отделяем столбец Действия
  const actionsCol = columns.find((c) => c.key === 'actions')
  const rest = columns.filter((c) => c.key !== 'actions')

  // Убираем скрытые
  const visible = rest.filter((c) => !config.hiddenColumns.includes(c.key ?? ''))

  // Переупорядочиваем
  if (config.columnOrder.length > 0) {
    visible.sort((a, b) => {
      const idxA = config.columnOrder.indexOf(a.key ?? '')
      const idxB = config.columnOrder.indexOf(b.key ?? '')
      // Столбцы не в columnOrder — в конец, сохраняя текущий порядок
      if (idxA === -1 && idxB === -1) return 0
      if (idxA === -1) return 1
      if (idxB === -1) return -1
      return idxA - idxB
    })
  }

  // Действия всегда последним
  if (actionsCol) visible.push(actionsCol)

  return visible
}
