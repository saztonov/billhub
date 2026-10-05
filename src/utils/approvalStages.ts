import { STAGE_OMTS, STAGE_RP, STAGE_SHTAB, STAGE_UOK } from '@/types'
import type { PaymentRequest } from '@/types'

type StageRecord = Pick<
  PaymentRequest,
  'currentStage' | 'rejectedStage' | 'stageHistory' | 'invoiceAmount'
>

/**
 * Требуется ли заявке этап «УОК» по сумме: строго свыше порога; без суммы — требуется
 * (как на сервере). Порог не загружен — неизвестно, считаем что не требуется.
 */
export function requiresUokStage(invoiceAmount: number | null, threshold: number | null): boolean {
  if (threshold === null) return false
  if (invoiceAmount === null) return true
  return invoiceAmount > threshold
}

/**
 * Фактический путь этапов заявки: Штаб → ОМТС → [УОК] → [РП].
 * УОК — если заявка на нём была/есть, либо (пока ОМТС не пройдено) сумма свыше порога;
 * РП — только по факту (текущий/отклонённый этап или запись в истории).
 */
export function requestStagePath(record: StageRecord, uokThreshold: number | null): number[] {
  const history = record.stageHistory ?? []
  const reached = (stage: number) =>
    record.currentStage === stage ||
    record.rejectedStage === stage ||
    history.some((e) => e.stage === stage)
  const pastOmts =
    (record.currentStage ?? 0) > STAGE_OMTS || (record.rejectedStage ?? 0) > STAGE_OMTS
  const withUok =
    reached(STAGE_UOK) || (!pastOmts && requiresUokStage(record.invoiceAmount, uokThreshold))
  return [
    STAGE_SHTAB,
    STAGE_OMTS,
    ...(withUok ? [STAGE_UOK] : []),
    ...(reached(STAGE_RP) ? [STAGE_RP] : []),
  ]
}

/** Доля пройденного пути (0–100) для заявки на этапе stage (этап ещё не пройден). */
export function stageProgressPercent(path: number[], stage: number): number {
  const idx = path.indexOf(stage)
  const completed = idx >= 0 ? idx : Math.min(stage - 1, path.length)
  return Math.round((completed / path.length) * 100)
}

/** Доля пути (0–100) до этапа отклонения включительно. */
export function rejectedProgressPercent(path: number[], rejectedStage: number | null): number {
  if (rejectedStage === null) return 100
  const idx = path.indexOf(rejectedStage)
  const reachedCount = idx >= 0 ? idx + 1 : Math.min(rejectedStage, path.length)
  return Math.round((reachedCount / path.length) * 100)
}
