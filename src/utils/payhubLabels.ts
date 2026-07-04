/** Опция инлайн-выбора PayHub (значение — id проекта/заказчика) */
export interface PayhubOption {
  value: number | string
  label: string
}

/**
 * Поиск по набираемым словам: запрос дробится на слова, каждое должно встретиться
 * в тексте опции (label уже включает code/name/inn — этого достаточно).
 */
export function wordFilter(input: string, option?: { label?: unknown }): boolean {
  const text = String(option?.label ?? '').toLowerCase()
  return input
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => text.includes(word))
}

/** Подпись проекта PayHub: «code — name», иначе name/code, иначе «#id» */
export function projectLabel(
  code: string | null | undefined,
  name: string | null | undefined,
  id: number | string,
): string {
  if (code && name) return `${code} — ${name}`
  return name || code || `#${id}`
}

/** Подпись заказчика PayHub: «name (inn)», иначе name/inn, иначе «#id» */
export function contractorLabel(
  name: string | null | undefined,
  inn: string | null | undefined,
  id: number | string,
): string {
  if (name && inn) return `${name} (${inn})`
  return name || inn || `#${id}`
}
