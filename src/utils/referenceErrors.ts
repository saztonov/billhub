import { ApiError } from '@/services/api'
import { INN_FORMAT_MESSAGE } from '@/utils/inn'

/** Название сущности справочника для текста сообщения */
export type ReferenceEntity = 'Подрядчик' | 'Поставщик'

/** Одна проблема zod-валидации в теле ответа 400 */
interface ValidationIssue {
  path?: unknown[]
}

/** Есть ли среди проблем валидации замечание по полю ИНН */
const hasInnIssue = (details: unknown): boolean => {
  const issues = (details as { details?: ValidationIssue[] } | null)?.details
  if (!Array.isArray(issues)) return false
  return issues.some((issue) => issue?.path?.[0] === 'inn')
}

/**
 * Понятный текст ошибки сохранения записи справочника.
 * Сервер отдаёт 409 при дубле ИНН (уникальный индекс) и 400 при непрошедшей валидации —
 * оба случая раньше не доходили до пользователя (см. SuppliersPage / CounterpartiesPage).
 */
/** Относится ли ошибка к полю ИНН — тогда её стоит показать прямо под полем */
export const isInnFieldError = (err: unknown): boolean => {
  if (!(err instanceof ApiError)) return false
  if (err.status === 409) return true
  return err.status === 400 && hasInnIssue(err.details)
}

export const describeReferenceError = (err: unknown, entity: ReferenceEntity): string => {
  if (err instanceof ApiError) {
    if (err.status === 409) return `${entity} с таким ИНН уже есть в справочнике`
    if (err.status === 400 && hasInnIssue(err.details)) {
      return `${INN_FORMAT_MESSAGE}, без лишних символов`
    }
    return err.message
  }
  return err instanceof Error ? err.message : 'Не удалось сохранить запись'
}
