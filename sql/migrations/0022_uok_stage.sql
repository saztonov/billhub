-- Миграция 0022: этап согласования «УОК» (stage 3) между ОМТС и РП; этап «РП» — stage 4.
--
-- Новая цепочка: Штаб (1) -> ОМТС (2) -> УОК (3, только при сумме счёта свыше порога)
--   -> РП (4, только для объектов с назначенцем в rp_stage_assignees) -> Согласована.
-- Значение department_enum 'uok' добавлено миграцией 0021.
--
-- Без top-level BEGIN/COMMIT — runner оборачивает миграцию в транзакцию (ADR-0002).

-- 1. Статус этапа УОК (код резолвится сервером по code, без строки переход на УОК упадёт).
INSERT INTO public.statuses (entity_type, code, name, color, display_order)
VALUES ('payment_request', 'approv_uok', 'Согласование УОК', 'orange', 3)
ON CONFLICT (entity_type, code) DO NOTHING;

-- 2. Порог суммы счёта для этапа УОК (строго больше порога -> этап УОК). Меняется в админке.
INSERT INTO public.settings (key, value)
VALUES ('uok_amount_threshold', '{"amount": 400000}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- 3. Перенумерация этапа «РП» 3 -> 4 (номер этапа = порядок решений и матчинг по current_stage).
--    До этой миграции stage 3 означал только РП (у всех заявок с current_stage=3 есть
--    pending-решение 'rp'), поэтому условия по номеру этапа однозначны.

-- 3.1. Решения этапа РП (pending/approved/rejected).
UPDATE public.approval_decisions
SET stage_order = 4
WHERE department_id = 'rp' AND stage_order = 3;

-- 3.2. Текущий этап заявок, стоящих на РП (включая припаркованные на доработке).
UPDATE public.payment_requests
SET current_stage = 4
WHERE current_stage = 3;

-- 3.3. Этап отклонения заявок, отклонённых на РП (по нему идёт уведомление при повторной отправке).
UPDATE public.payment_requests
SET rejected_stage = 4
WHERE rejected_stage = 3;

-- 3.4. История этапов: записи РП (stage 3, department 'rp') -> stage 4; порядок записей сохраняется.
UPDATE public.payment_requests pr
SET stage_history = (
    SELECT jsonb_agg(
        CASE
            WHEN e->>'department' = 'rp' AND e->>'stage' = '3' THEN jsonb_set(e, '{stage}', '4'::jsonb)
            ELSE e
        END
        ORDER BY ord
    )
    FROM jsonb_array_elements(pr.stage_history) WITH ORDINALITY AS t(e, ord)
)
WHERE jsonb_typeof(pr.stage_history) = 'array'
  AND EXISTS (
      SELECT 1 FROM jsonb_array_elements(pr.stage_history) AS h(e)
      WHERE h.e->>'department' = 'rp' AND h.e->>'stage' = '3'
  );
