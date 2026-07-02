/**
 * postgres.js по умолчанию отдаёт NUMERIC/DECIMAL (OID 1700) как JS string — чтобы не терять
 * точность произвольных чисел. Но Supabase (PostgREST), под который написан весь фронтенд и
 * бизнес-логика, всегда сериализовал numeric-колонки как JSON-числа. Без этого переопределения
 * арифметика вида `sum + amount` над денежными полями (payment_requests.invoice_amount,
 * payments.amount, invoices_ocr.total_amount и т.д.) превращается в конкатенацию строк вместо
 * сложения — итоговые суммы отображаются как слипшийся мусор.
 *
 * precision/scale денежных полей в схеме — (15, 2..6), что далеко в пределах точности float64:
 * регресса точности относительно прежнего поведения (Supabase JSON-числа — тоже float64) нет.
 */
export const pgNumericAsNumberTypes = {
  numeric: {
    to: 1700,
    from: [1700] as number[],
    parse: (raw: string): number => Number(raw),
    serialize: (value: number): string => String(value),
  },
};
