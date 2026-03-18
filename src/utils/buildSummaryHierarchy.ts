import type {
  HierarchicalRawRow,
  HierarchyFlatRow,
  HierarchyGroupRow,
  HierarchyCounterpartyRow,
  HierarchyMaterialRow,
} from '@/store/materialsStore'

/** Построение плоского списка с группировочными строками для иерархической сводной */
export function buildSummaryHierarchy(raw: HierarchicalRawRow[]): HierarchyFlatRow[] {
  // Группируем: Вид затрат -> Объект -> Подрядчик -> Материалы
  const tree: Record<string, Record<string, Record<string, HierarchicalRawRow[]>>> = {}

  for (const row of raw) {
    const ctKey = row.costTypeId ?? '__none__'
    if (!tree[ctKey]) tree[ctKey] = {}
    if (!tree[ctKey][row.siteId]) tree[ctKey][row.siteId] = {}
    if (!tree[ctKey][row.siteId][row.counterpartyId]) tree[ctKey][row.siteId][row.counterpartyId] = []
    tree[ctKey][row.siteId][row.counterpartyId].push(row)
  }

  const result: HierarchyFlatRow[] = []

  // Сортируем виды затрат: "Без вида затрат" в конец
  const costTypeKeys = Object.keys(tree).sort((a, b) => {
    if (a === '__none__') return 1
    if (b === '__none__') return -1
    const nameA = tree[a][Object.keys(tree[a])[0]][Object.keys(tree[a][Object.keys(tree[a])[0]])[0]][0].costTypeName ?? ''
    const nameB = tree[b][Object.keys(tree[b])[0]][Object.keys(tree[b][Object.keys(tree[b])[0]])[0]][0].costTypeName ?? ''
    return nameA.localeCompare(nameB, 'ru')
  })

  for (const ctKey of costTypeKeys) {
    const sites = tree[ctKey]
    // Агрегация по виду затрат
    let ctAmount = 0
    let ctQuantity = 0
    let ctEstimate = 0
    const ctName = ctKey === '__none__'
      ? 'Без вида затрат'
      : Object.values(sites)[0][Object.keys(Object.values(sites)[0])[0]][0].costTypeName ?? ''

    // Сначала считаем итоги по виду затрат
    for (const siteId of Object.keys(sites)) {
      for (const cpId of Object.keys(sites[siteId])) {
        for (const row of sites[siteId][cpId]) {
          ctAmount += row.amount
          ctQuantity += row.quantity
          ctEstimate += row.estimateQuantity
        }
      }
    }

    const costTypeRow: HierarchyGroupRow = {
      key: `ct_${ctKey}`,
      level: 'costType',
      label: ctName,
      totalAmount: ctAmount,
      totalQuantity: ctQuantity,
      totalEstimateQuantity: ctEstimate,
      deviation: ctQuantity - ctEstimate,
    }
    result.push(costTypeRow)

    // Сортируем объекты
    const siteKeys = Object.keys(sites).sort((a, b) => {
      const nameA = sites[a][Object.keys(sites[a])[0]][0].siteName
      const nameB = sites[b][Object.keys(sites[b])[0]][0].siteName
      return nameA.localeCompare(nameB, 'ru')
    })

    for (const siteId of siteKeys) {
      const counterparties = sites[siteId]
      let siteAmount = 0
      let siteQuantity = 0
      let siteEstimate = 0
      const siteName = counterparties[Object.keys(counterparties)[0]][0].siteName

      for (const cpId of Object.keys(counterparties)) {
        for (const row of counterparties[cpId]) {
          siteAmount += row.amount
          siteQuantity += row.quantity
          siteEstimate += row.estimateQuantity
        }
      }

      const siteRow: HierarchyGroupRow = {
        key: `site_${ctKey}_${siteId}`,
        level: 'site',
        label: siteName,
        totalAmount: siteAmount,
        totalQuantity: siteQuantity,
        totalEstimateQuantity: siteEstimate,
        deviation: siteQuantity - siteEstimate,
      }
      result.push(siteRow)

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
              key: `mat_${ctKey}_${siteId}_${cpId}_${row.materialId}`,
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
          key: `cp_${ctKey}_${siteId}_${cpId}`,
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

/** Проверка: является ли строка группировочной */
export function isGroupRow(row: HierarchyFlatRow): row is HierarchyGroupRow {
  return 'level' in row
}

/** Проверка: является ли строка подрядчиком */
export function isCounterpartyRow(row: HierarchyFlatRow): row is HierarchyCounterpartyRow {
  return 'counterpartyId' in row
}
