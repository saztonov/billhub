/**
 * Серверная автосборка текста письма РП — аналог фронтовой buildRpLetterContent
 * (src/components/rp/rpLetterContent.ts): «<сумма> ₽, <поставщик>, <описание1>, …».
 * Используется при автосоздании РП на этапе согласования «РП».
 */

/** Тема письма РП по умолчанию (как в форме создания письма). */
export const RP_LETTER_DEFAULT_SUBJECT = 'РП';

export interface RpLetterContentSource {
  invoiceAmount: number | null;
  supplierName: string | null;
  comment: string | null;
}

/** Содержание письма: сумма по заявкам, поставщик (связка одна), непустые комментарии. */
export function buildRpLetterContent(requests: RpLetterContentSource[]): string {
  if (requests.length === 0) return '';
  const total = requests.reduce((sum, r) => sum + (r.invoiceAmount ?? 0), 0);
  const parts: string[] = [
    `${total.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽`,
  ];
  const supplierName = requests[0]?.supplierName?.trim();
  if (supplierName) parts.push(supplierName);
  for (const r of requests) {
    const comment = (r.comment ?? '').trim();
    if (comment) parts.push(comment);
  }
  return parts.join(', ');
}

/** Текущая дата по Москве в формате YYYY-MM-DD (дата письма РП). */
export function moscowToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}
