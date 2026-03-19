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

    let siteAmount = 0
    let siteQuantity = 0
    let siteEstimate = 0
    let siteDeviation = 0
    let siteDeviationAmount = 0
    const siteName = getFirstRow(costTypes).siteName

    // Строка объекта (deviationAmount обновится после подсчёта дочерних)
    const siteRow: HierarchyGroupRow = {
      key: `site_${siteId}`,
      level: 'site',
      label: siteName,
      totalAmount: 0,
      totalQuantity: 0,
      totalEstimateQuantity: 0,
      deviation: 0,
      deviationAmount: 0,
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
      let ctDeviation = 0
      let ctDeviationAmount = 0
      const ctName = ctKey === '__none__'
        ? 'Без вида затрат'
        : getFirstRow(counterparties).costTypeName ?? ''

      // Строка вида затрат (обновится после подсчёта дочерних)
      const costTypeRow: HierarchyGroupRow = {
        key: `ct_${siteId}_${ctKey}`,
        level: 'costType',
        label: ctName,
        totalAmount: 0,
        totalQuantity: 0,
        totalEstimateQuantity: 0,
        deviation: 0,
        deviationAmount: 0,
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
        // Количество только из строк с заполненным estimateQuantity (для deviation)
        const matDevQuantity: Record<string, number> = {}

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
              deviationAmount: 0,
            }
            matDevQuantity[row.materialId] = 0
          }
          matMap[row.materialId].totalQuantity += row.quantity
          matMap[row.materialId].totalAmount += row.amount
          // Строки с пустым estimateQuantity не участвуют в расчёте отклонения
          if (row.estimateQuantity != null) {
            matMap[row.materialId].totalEstimateQuantity += row.estimateQuantity
            matDevQuantity[row.materialId] += row.quantity
          }
        }

        const materials = Object.entries(matMap)
          .map(([matId, m]) => {
            const avgPrice = m.totalQuantity > 0 ? m.totalAmount / m.totalQuantity : 0
            const dev = matDevQuantity[matId] - m.totalEstimateQuantity
            return {
              ...m,
              averagePrice: avgPrice,
              deviation: dev,
              deviationAmount: dev * avgPrice,
            }
          })
          .sort((a, b) => a.materialName.localeCompare(b.materialName, 'ru'))

        let cpAmount = 0
        let cpQuantity = 0
        let cpEstimate = 0
        let cpDeviation = 0
        let cpDeviationAmount = 0
        for (const m of materials) {
          cpAmount += m.totalAmount
          cpQuantity += m.totalQuantity
          cpEstimate += m.totalEstimateQuantity
          cpDeviation += m.deviation
          cpDeviationAmount += m.deviationAmount
        }

        const cpRow: HierarchyCounterpartyRow = {
          key: `cp_${siteId}_${ctKey}_${cpId}`,
          counterpartyId: cpId,
          counterpartyName: cpName,
          totalAmount: cpAmount,
          totalQuantity: cpQuantity,
          totalEstimateQuantity: cpEstimate,
          deviation: cpDeviation,
          deviationAmount: cpDeviationAmount,
          materials,
        }
        result.push(cpRow)

        ctAmount += cpAmount
        ctQuantity += cpQuantity
        ctEstimate += cpEstimate
        ctDeviation += cpDeviation
        ctDeviationAmount += cpDeviationAmount
      }

      // Обновляем строку вида затрат
      costTypeRow.totalAmount = ctAmount
      costTypeRow.totalQuantity = ctQuantity
      costTypeRow.totalEstimateQuantity = ctEstimate
      costTypeRow.deviation = ctDeviation
      costTypeRow.deviationAmount = ctDeviationAmount

      siteAmount += ctAmount
      siteQuantity += ctQuantity
      siteEstimate += ctEstimate
      siteDeviation += ctDeviation
      siteDeviationAmount += ctDeviationAmount
    }

    // Обновляем строку объекта
    siteRow.totalAmount = siteAmount
    siteRow.totalQuantity = siteQuantity
    siteRow.totalEstimateQuantity = siteEstimate
    siteRow.deviation = siteDeviation
    siteRow.deviationAmount = siteDeviationAmount
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
