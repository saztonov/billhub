/**
 * Отчёт «Экономия по заявкам на оплату» (админка → Отчёты).
 *
 * Что считается экономией: любое УМЕНЬШЕНИЕ суммы счёта в процессе обработки заявки.
 * Источник — `payment_requests.invoice_amount_history`: при каждом изменении суммы туда
 * уходит ПРЕЖНЕЕ значение (и при правке сотрудником, и при завершении доработки
 * контрагентом). Историю логов правок (`payment_request_logs`) как источник использовать
 * нельзя: до появления выбора причины редактирования снижение оформлялось через возврат
 * на доработку, и явной правки суммы в логах нет.
 *
 * Событие изменения — пара соседних значений: запись истории (старая сумма) и следующее
 * значение (следующая запись истории либо текущая `invoice_amount`). Дата события —
 * `changedAt` записи со старой суммой.
 *
 * Правила отбора:
 *  - только события, где новая сумма меньше старой (повышения не вычитаются);
 *  - только заявки, дошедшие до согласования (`approved_at` заполнен), не удалённые;
 *  - исключаются правки, оформленные как исправление ошибки (invoiceAmountReason='error').
 *
 * Автор экономии — сотрудник ОМТС, последним действовавший по заявке до события
 * (`revision` — вернул на доработку, либо `edit` — правил сам); если такого действия нет,
 * берётся текущий назначенный исполнитель заявки.
 */
import { sql } from 'drizzle-orm';
import type { BillhubDatabase } from '../../plugins/database-drizzle.js';

/** Часовой пояс отчётных месяцев: границы месяца считаются по локальному времени компании. */
const REPORT_TIMEZONE = 'Asia/Yekaterinburg';

/**
 * Тот же пояс как SQL-литерал: `AT TIME ZONE $n` не даёт PostgreSQL вывести тип параметра,
 * поэтому зона подставляется константой из кода (не пользовательский ввод — инъекции нет).
 */
const TZ_LITERAL = sql.raw(`'${REPORT_TIMEZONE}'`);

/** Экономия одного сотрудника ОМТС внутри месяца. */
export interface SavingsByUser {
  userId: string | null;
  fullName: string | null;
  count: number;
  saved: number;
}

/** Итог месяца с разбивкой по сотрудникам. */
export interface SavingsMonth {
  month: string;
  count: number;
  saved: number;
  byUser: SavingsByUser[];
}

/** Ответ отчёта: период, итог и помесячные данные (свежий месяц первым). */
export interface SavingsReport {
  from: string;
  to: string;
  total: { count: number; saved: number };
  months: SavingsMonth[];
}

/** Одно снижение суммы: строка листа «Детализация» выгрузки. */
export interface SavingsDetailRow {
  date: string;
  requestNumber: string | null;
  siteName: string | null;
  counterpartyName: string | null;
  supplierName: string | null;
  amountBefore: number;
  amountAfter: number;
  saved: number;
  fullName: string | null;
}

/** Детализация отчёта: период и список снижений (свежие первыми). */
export interface SavingsDetails {
  from: string;
  to: string;
  rows: SavingsDetailRow[];
}

/** Строка агрегата из БД: месяц × сотрудник. */
interface ReportRow {
  month: string;
  user_id: string | null;
  full_name: string | null;
  cnt: number;
  saved: number;
}

/** Сдвиг месяца YYYY-MM на `delta` месяцев. */
export function shiftMonth(month: string, delta: number): string {
  const [year, mon] = month.split('-').map(Number);
  const zeroBased = (year as number) * 12 + (mon as number) - 1 + delta;
  const y = Math.floor(zeroBased / 12);
  const m = zeroBased - y * 12 + 1;
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}`;
}

/** Текущий месяц YYYY-MM в отчётном часовом поясе. */
export function currentMonth(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: REPORT_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(now);
  const year = parts.find((p) => p.type === 'year')?.value ?? '1970';
  const month = parts.find((p) => p.type === 'month')?.value ?? '01';
  return `${year}-${month}`;
}

/**
 * Период по умолчанию — последние 12 месяцев включительно (текущий месяц последний).
 * Если задана только одна граница, вторая достраивается тем же окном.
 */
export function resolvePeriod(
  query: { from?: string; to?: string },
  now: Date = new Date(),
): { from: string; to: string } {
  const to = query.to ?? (query.from ? shiftMonth(query.from, 11) : currentMonth(now));
  const from = query.from ?? shiftMonth(to, -11);
  return from <= to ? { from, to } : { from: to, to: from };
}

/**
 * Общая часть обоих отчётов: разворот истории сумм → отбор снижений за период →
 * отсев исправлений ошибки → атрибуция автора. Сводка и детализация обязаны считаться
 * по одной методике, поэтому CTE один на двоих, а запросы отличаются финальной выборкой.
 * Итоговый CTE `attributed` отдаёт: pr_id, changed_at, prev_amount, next_amount, saved, author_id.
 */
function savingsEventsCte(from: string, to: string) {
  return sql`
    WITH ev AS (
      SELECT pr.id AS pr_id,
             (h.value->>'amount')::numeric AS prev_amount,
             (h.value->>'changedAt')::timestamptz AS changed_at,
             COALESCE(
               (pr.invoice_amount_history->(h.ordinality::int)->>'amount')::numeric,
               pr.invoice_amount
             ) AS next_amount
      FROM payment_requests pr
      CROSS JOIN LATERAL jsonb_array_elements(pr.invoice_amount_history)
           WITH ORDINALITY h(value, ordinality)
      WHERE pr.is_deleted = false
        AND pr.approved_at IS NOT NULL
    ),
    down AS (
      SELECT pr_id, changed_at, prev_amount, next_amount, prev_amount - next_amount AS saved
      FROM ev
      WHERE next_amount < prev_amount
    ),
    filtered AS (
      SELECT d.pr_id, d.changed_at, d.prev_amount, d.next_amount, d.saved
      FROM down d
      WHERE d.changed_at >= (to_date(${from}::text, 'YYYY-MM')::timestamp AT TIME ZONE ${TZ_LITERAL})
        AND d.changed_at < ((to_date(${to}::text, 'YYYY-MM') + interval '1 month')::timestamp
                             AT TIME ZONE ${TZ_LITERAL})
        AND NOT EXISTS (
          SELECT 1 FROM payment_request_logs l
          WHERE l.payment_request_id = d.pr_id
            AND l.details->>'invoiceAmountReason' = 'error'
            AND abs(extract(epoch FROM (l.created_at - d.changed_at))) <= 5
        )
    ),
    attributed AS (
      SELECT f.pr_id,
             f.changed_at,
             f.prev_amount,
             f.next_amount,
             f.saved,
             COALESCE(
               (SELECT l.user_id
                  FROM payment_request_logs l
                  JOIN users u ON u.id = l.user_id
                 WHERE l.payment_request_id = f.pr_id
                   AND l.created_at <= f.changed_at + interval '5 second'
                   AND l.action IN ('revision', 'edit')
                   AND u.department_id::text = 'omts'
                 ORDER BY l.created_at DESC
                 LIMIT 1),
               (SELECT a.assigned_user_id
                  FROM payment_request_assignments a
                 WHERE a.payment_request_id = f.pr_id
                   AND a.is_current = true
                 ORDER BY a.assigned_at DESC
                 LIMIT 1)
             ) AS author_id
      FROM filtered f
    )
  `;
}

/**
 * Помесячная экономия за период с разбивкой по сотрудникам ОМТС.
 * Один запрос: события экономии (см. `savingsEventsCte`) → агрегация по месяцу и сотруднику.
 */
export async function getSavingsReport(
  db: BillhubDatabase,
  query: { from?: string; to?: string },
  now: Date = new Date(),
): Promise<SavingsReport> {
  const { from, to } = resolvePeriod(query, now);

  const res = await db.execute(sql`
    ${savingsEventsCte(from, to)}
    SELECT to_char(a.changed_at AT TIME ZONE ${TZ_LITERAL}, 'YYYY-MM') AS month,
           a.author_id::text AS user_id,
           u.full_name AS full_name,
           count(*)::int AS cnt,
           sum(a.saved)::float8 AS saved
    FROM attributed a
    LEFT JOIN users u ON u.id = a.author_id
    GROUP BY 1, 2, 3
    ORDER BY 1 DESC, 5 DESC
  `);

  const rows = res as unknown as ReportRow[];

  const byMonth = new Map<string, SavingsMonth>();
  for (const row of rows) {
    let month = byMonth.get(row.month);
    if (!month) {
      month = { month: row.month, count: 0, saved: 0, byUser: [] };
      byMonth.set(row.month, month);
    }
    const count = Number(row.cnt);
    const saved = Number(row.saved);
    month.count += count;
    month.saved += saved;
    month.byUser.push({
      userId: row.user_id,
      fullName: row.full_name,
      count,
      saved,
    });
  }

  const months = [...byMonth.values()];
  const total = months.reduce(
    (acc, m) => ({ count: acc.count + m.count, saved: acc.saved + m.saved }),
    { count: 0, saved: 0 },
  );

  return { from, to, total, months };
}

/** Строка детализации из БД (snake_case, как отдаёт SQL). */
interface DetailRow {
  date: string;
  request_number: string | null;
  site_name: string | null;
  counterparty_name: string | null;
  supplier_name: string | null;
  amount_before: number;
  amount_after: number;
  saved: number;
  full_name: string | null;
}

/**
 * Детализация экономии: строка на каждое снижение за период — для выгрузки в Excel.
 * Считается тем же CTE, что и сводка, поэтому суммы сходятся с помесячными итогами.
 */
export async function getSavingsDetails(
  db: BillhubDatabase,
  query: { from?: string; to?: string },
  now: Date = new Date(),
): Promise<SavingsDetails> {
  const { from, to } = resolvePeriod(query, now);

  const res = await db.execute(sql`
    ${savingsEventsCte(from, to)}
    SELECT to_char(a.changed_at AT TIME ZONE ${TZ_LITERAL}, 'YYYY-MM-DD') AS date,
           pr.request_number AS request_number,
           cs.name AS site_name,
           c.name AS counterparty_name,
           s.name AS supplier_name,
           a.prev_amount::float8 AS amount_before,
           a.next_amount::float8 AS amount_after,
           a.saved::float8 AS saved,
           u.full_name AS full_name
    FROM attributed a
    JOIN payment_requests pr ON pr.id = a.pr_id
    LEFT JOIN users u ON u.id = a.author_id
    LEFT JOIN construction_sites cs ON cs.id = pr.site_id
    LEFT JOIN counterparties c ON c.id = pr.counterparty_id
    LEFT JOIN suppliers s ON s.id = pr.supplier_id
    ORDER BY a.changed_at DESC
  `);

  const rows = (res as unknown as DetailRow[]).map((r) => ({
    date: r.date,
    requestNumber: r.request_number,
    siteName: r.site_name,
    counterpartyName: r.counterparty_name,
    supplierName: r.supplier_name,
    amountBefore: Number(r.amount_before),
    amountAfter: Number(r.amount_after),
    saved: Number(r.saved),
    fullName: r.full_name,
  }));

  return { from, to, rows };
}
