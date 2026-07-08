-- Миграция 0014: разовая расшивка рассинхрона «статус согласования <-> approval_decisions».
--
-- Контекст:
--   Из-за гонки «На доработку -> Согласовать -> Доработано» заявка возвращалась в статус
--   согласования (approv_omts/approv_omts_rp) без действующей pending-строки в approval_decisions,
--   из-за чего кнопка «Согласовать» пропадала у всех (pending-очередь строится из approval_decisions,
--   а не из статуса). Код-фикс (запрет согласования во время доработки + очистка previous_status_id)
--   устраняет причину; эта миграция чинит уже залипшие заявки:
--     - 803 — обычная стадия ОМТС (is_omts_rp = false);
--     - 713 — под-стадия ОМТС-РП (is_omts_rp = true).
--   Заявки 383 и 576 намеренно НЕ трогаем (обрабатываются отдельно).
--
-- Без top-level BEGIN/COMMIT — runner оборачивает миграцию в транзакцию (ADR-0002).
-- Идемпотентность — через NOT EXISTS: повторный накат не создаст дубль pending.

-- 803: вернуть pending обычной стадии ОМТС
INSERT INTO public.approval_decisions (payment_request_id, stage_order, department_id, status, is_omts_rp)
SELECT pr.id, 2, 'omts', 'pending', false
FROM public.payment_requests pr
WHERE pr.request_number = '803'
  AND NOT EXISTS (
    SELECT 1 FROM public.approval_decisions ad
    WHERE ad.payment_request_id = pr.id AND ad.status = 'pending'
  );

-- 713: вернуть pending под-стадии ОМТС-РП
INSERT INTO public.approval_decisions (payment_request_id, stage_order, department_id, status, is_omts_rp)
SELECT pr.id, 2, 'omts', 'pending', true
FROM public.payment_requests pr
WHERE pr.request_number = '713'
  AND NOT EXISTS (
    SELECT 1 FROM public.approval_decisions ad
    WHERE ad.payment_request_id = pr.id AND ad.status = 'pending'
  );

-- Вернуть стадию согласования, снять ошибочные финальные метки, добавить аудит-запись в историю
UPDATE public.payment_requests
SET current_stage = 2,
    approved_at = NULL,
    previous_status_id = NULL,
    stage_history = COALESCE(stage_history, '[]'::jsonb) || jsonb_build_object(
      'event', 'repair', 'stage', 2, 'department', 'omts',
      'note', 'восстановлена pending-строка (расшивка рассинхрона статус/decisions, миграция 0014)',
      'at', to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
WHERE request_number IN ('803', '713');
