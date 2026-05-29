-- Миграция: денормализованный статус последнего решения СБ у поставщика
--
-- До этого «последний статус проверки СБ» вычислялся только в RPC list_suppliers_with_sb
-- (страница справочника «Поставщики»). Для блокировок создания/продвижения заявок и для
-- подсветки в списках заявок и выпадающих списках статус нужен во всех выборках по suppliers.
--
-- Добавляем колонку suppliers.last_security_status со значением последнего РЕШЕНИЯ СБ
-- (approved | rejected | NULL). Колонка обновляется приложением в единственном месте —
-- эндпоинте решения СБ (:id/security-checks/decision). Событие 'requested' статус не меняет.
--
-- «Поставщик отклонён СБ» = last_security_status = 'rejected'.
-- Миграция считает предыдущие (001-005) уже применёнными.

BEGIN;

-- 1. Колонка с типом последнего решения СБ
ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS last_security_status text NULL
    CONSTRAINT suppliers_last_security_status_check
      CHECK (last_security_status = ANY (ARRAY['approved'::text, 'rejected'::text]));

-- 2. Backfill: для каждого поставщика берём последнее по времени решение (approved/rejected)
UPDATE public.suppliers s
SET last_security_status = d.event_type
FROM (
  SELECT DISTINCT ON (supplier_id) supplier_id, event_type
  FROM public.supplier_security_checks
  WHERE event_type IN ('approved', 'rejected')
  ORDER BY supplier_id, created_at DESC
) d
WHERE d.supplier_id = s.id;

COMMIT;
