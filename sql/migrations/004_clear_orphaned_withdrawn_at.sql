-- Миграция: снять «висящий» флаг отзыва у реанимированных заявок
--
-- Если заявку отозвали во время доработки, а затем вернули в работу
-- («Доработано» / повторная отправка), поле withdrawn_at оставалось
-- проставленным, хотя статус заявки уже активный. Из-за фильтра
-- withdrawn_at IS NULL в эндпоинтах согласования такие заявки выпадали из
-- pending-списков, и для них пропадала кнопка «Согласовать».
--
-- Снимаем флаг отзыва у всех заявок, где withdrawn_at проставлен, но статус
-- не «Отозвана» (code <> 'withdrawn'). Затрагивает заявки 543, 98, 104.
-- (Код приложения отдельно дорабатывается так, чтобы пути реактивации —
-- завершение доработки и повторная отправка — сами очищали этот флаг.)

BEGIN;

UPDATE public.payment_requests pr
SET withdrawn_at = NULL,
    withdrawal_comment = NULL
WHERE pr.withdrawn_at IS NOT NULL
  AND pr.status_id NOT IN (
    SELECT id FROM public.statuses
    WHERE entity_type = 'payment_request' AND code = 'withdrawn'
  );

COMMIT;
