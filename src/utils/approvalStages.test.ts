import { describe, it, expect } from 'vitest'
import {
  rejectedProgressPercent,
  requestStagePath,
  requiresUokStage,
  stageProgressPercent,
} from './approvalStages'
import type { StageHistoryEntry } from '@/types'

const rec = (over: {
  currentStage?: number | null
  rejectedStage?: number | null
  stageHistory?: StageHistoryEntry[]
  invoiceAmount?: number | null
}) => ({
  currentStage: over.currentStage ?? null,
  rejectedStage: over.rejectedStage ?? null,
  stageHistory: over.stageHistory ?? [],
  invoiceAmount: over.invoiceAmount === undefined ? 100 : over.invoiceAmount,
})

const h = (stage: number, department: string): StageHistoryEntry => ({
  stage,
  department,
  event: 'received',
  at: '2026-01-01T00:00:00Z',
})

describe('approvalStages', () => {
  it('requiresUokStage: строго свыше порога; без суммы — требуется; без порога — нет', () => {
    expect(requiresUokStage(400_001, 400_000)).toBe(true)
    expect(requiresUokStage(400_000, 400_000)).toBe(false)
    expect(requiresUokStage(null, 400_000)).toBe(true)
    expect(requiresUokStage(900_000, null)).toBe(false)
  })

  it('до ОМТС: УОК прогнозируется по сумме', () => {
    expect(requestStagePath(rec({ currentStage: 1, invoiceAmount: 500_000 }), 400_000)).toEqual([
      1, 2, 3,
    ])
    expect(requestStagePath(rec({ currentStage: 2, invoiceAmount: 100 }), 400_000)).toEqual([1, 2])
  })

  it('после ОМТС: УОК и РП — только по факту', () => {
    // На РП без УОК (сумма ниже порога либо легаси до появления этапа УОК).
    expect(requestStagePath(rec({ currentStage: 4, invoiceAmount: 900_000 }), 400_000)).toEqual([
      1, 2, 4,
    ])
    // Прошла УОК, сейчас на РП.
    expect(
      requestStagePath(rec({ currentStage: 4, stageHistory: [h(3, 'uok')] }), 400_000),
    ).toEqual([1, 2, 3, 4])
    // Отклонена на УОК.
    expect(requestStagePath(rec({ rejectedStage: 3 }), 400_000)).toEqual([1, 2, 3])
  })

  it('проценты прогресса по пути', () => {
    expect(stageProgressPercent([1, 2, 3], 3)).toBe(67)
    expect(stageProgressPercent([1, 2, 4], 4)).toBe(67)
    expect(stageProgressPercent([1, 2], 1)).toBe(0)
    expect(rejectedProgressPercent([1, 2, 3], 3)).toBe(100)
    expect(rejectedProgressPercent([1, 2], 1)).toBe(50)
    expect(rejectedProgressPercent([1, 2, 3, 4], null)).toBe(100)
  })
})
