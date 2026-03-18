import type {
  HierarchicalRawRow,
  HierarchyFlatRow,
  HierarchyGroupRow,
  HierarchyCounterpartyRow,
  HierarchyMaterialRow,
} from '@/store/materialsStore'

/** Построение плоского списка с группировочными строками для иерархической сводной */
export function buildSummaryHierarchy(raw: HierarchicalRawRow[]): HierarchyFlatRow[] {
  // Группируем: Объект -> Вид затрат -> Подрядчик -> Материалы
  const tree: Record<string, Record<string, Record<string, HierarchicalRawRow[]>>> = {}

  for (const row of raw) {
    const ctKey = row.costTypeId ?? '__none__'
    if (!tree[row.siteId]) tree[row.siteId] = {}
    if (!tree[row.siteId][ctKey]) tree[row.siteId][ctKey] = {}
    if (!tree[row.siteId][ctKey][row.counterpartyId]) tree[row.siteId][ctKey][row.counterpartyId] = []
    tree[row.siteId][ctKey][row.counterpartyId].push(row)
  }

  const result: HierarchyFlatRow[] = []

  // Сортируем объекты
  const siteKeys = Object.keys(tree).sort((a, b) => {
    const nameA = getFirstRow(tree[a]).siteName
    const nameB = getFirstRow(tree[b]).siteName
    return nameA.localeCompare(nameB, 'ru')
  })

  for (const siteId of siteKeys) {
    const costTypes = tree[siteId]

    // Агрегация по объекту
    let siteAmount = 0
    let siteQuantity = 0
    let siteEstimate = 0
    const siteName = getFirstRow(costTypes).siteName

    for (const ctKey of Object.keys(costTypes)) {
      for (const cpId of Object.keys(costTypes[ctKey])) {
        for (const row of costTypes[ctKey][cpId]) {
          siteAmount += row.amount
          siteQuantity += row.quantity
          siteEstimate += row.estimateQuantity
        }
      }
    }

    const siteRow: HierarchyGroupRow = {
      key: `site_${siteId}`,
      level: 'site',
      label: siteName,
      totalAmount: siteAmount,
      totalQuantity: siteQuantity,
      totalEstimateQuantity: siteEstimate,
      deviation: siteQuantity - siteEstimate,
    }
    result.push(siteRow)

    // Сортируем виды затрат: "Без вида затрат" в конец
    const ctKeys = Object.keys(costTypes).sort((a, b) => {
      if (a === '__none__') return 1
      if (b === '__none__') return -1
      const nameA = getFirstRow(costTypes[a]).costTypeName ?? ''
      const nameB = getFirstRow(costTypes[b]).costTypeName ?? ''
      return nameA.localeCompare(nameB, 'ru')
    })

    for (const ctKey of ctKeys) {
      const counterparties = costTypes[ctKey]

      let ctAmount = 0
      let ctQuantity = 0
      let ctEstimate = 0
      const ctName = ctKey === '__none__'
        ? 'Без вида затрат'
        : getFirstRow(counterparties).costTypeName ?? ''

      for (const cpId of Object.keys(counterparties)) {
        for (const row of counterparties[cpId]) {
          ctAmount += row.amount
          ctQuantity += row.quantity
          ctEstimate += row.estimateQuantity
        }
      }

      const costTypeRow: HierarchyGroupRow = {
        key: `ct_${siteId}_${ctKey}`,
        level: 'costType',
        label: ctName,
        totalAmount: ctAmount,
        totalQuantity: ctQuantity,
        totalEstimateQuantity: ctEstimate,
        deviation: ctQuantity - ctEstimate,
      }
      result.push(costTypeRow)

      // Сортируем подрядчиков
      const cpKeys = Object.keys(counterparties).sort((a, b) => {
        const nameA = counterparties[a][0].counterpartyName
        const nameB = counterparties[b][0].counterpartyName
        return nameA.localeCompare(nameB, 'ru')
      })

      for (const cpId of cpKeys) {
        const rows = counterparties[cpId]
        const cpName = rows[0].counterpartyName

        // Группируем материалы внутри подрядчика по materialId
        const matMap: Record<string, HierarchyMaterialRow> = {}
        for (const row of rows) {
          if (!matMap[row.materialId]) {
            matMap[row.materialId] = {
              key: `mat_${siteId}_${ctKey}_${cpId}_${row.materialId}`,
              materialId: row.materialId,
              materialName: row.materialName,
              materialUnit: row.materialUnit,
              totalQuantity: 0,
              averagePrice: 0,
              totalAmount: 0,
              totalEstimateQuantity: 0,
              deviation: 0,
            }
          }
          matMap[row.materialId].totalQuantity += row.quantity
          matMap[row.materialId].totalAmount += row.amount
          matMap[row.materialId].totalEstimateQuantity += row.estimateQuantity
        }

        const materials = Object.values(matMap)
          .map((m) => ({
            ...m,
            averagePrice: m.totalQuantity > 0 ? m.totalAmount / m.totalQuantity : 0,
            deviation: m.totalQuantity - m.totalEstimateQuantity,
          }))
          .sort((a, b) => a.materialName.localeCompare(b.materialName, 'ru'))

        let cpAmount = 0
        let cpQuantity = 0
        let cpEstimate = 0
        for (const m of materials) {
          cpAmount += m.totalAmount
          cpQuantity += m.totalQuantity
          cpEstimate += m.totalEstimateQuantity
        }

        const cpRow: HierarchyCounterpartyRow = {
          key: `cp_${siteId}_${ctKey}_${cpId}`,
          counterpartyId: cpId,
          counterpartyName: cpName,
          totalAmount: cpAmount,
          totalQuantity: cpQuantity,
          totalEstimateQuantity: cpEstimate,
          deviation: cpQuantity - cpEstimate,
          materials,
        }
        result.push(cpRow)
      }
    }
  }

  return result
}

/** Получить первую строку из вложенной структуры */
function getFirstRow(obj: Record<string, Record<string, HierarchicalRawRow[]>>): HierarchicalRawRow
function getFirstRow(obj: Record<string, HierarchicalRawRow[]>): HierarchicalRawRow
function getFirstRow(obj: Record<string, Record<string, HierarchicalRawRow[]>> | Record<string, HierarchicalRawRow[]>): HierarchicalRawRow {
  const firstVal = Object.values(obj)[0]
  if (Array.isArray(firstVal)) return firstVal[0]
  return getFirstRow(firstVal as Record<string, HierarchicalRawRow[]>)
}

/** Проверка: является ли строка группировочной */
export function isGroupRow(row: HierarchyFlatRow): row is HierarchyGroupRow {
  return 'level' in row
}

/** Проверка: является ли строка подрядчиком */
export function isCounterpartyRow(row: HierarchyFlatRow): row is HierarchyCounterpartyRow {
  return 'counterpartyId' in row
}
