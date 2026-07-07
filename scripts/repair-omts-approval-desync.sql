-- Разовый ремонт данных: расшивка рассинхрона «статус согласования <-> approval_decisions».
--
-- Контекст: из-за гонки «На доработку -> Согласовать -> Доработано» заявка возвращалась в статус
-- согласования (approv_omts/approv_omts_rp) без действующей pending-строки в approval_decisions,
-- из-за чего кнопка «Согласовать» пропадала у всех. Код-фикс (запрет согласования во время
-- доработки + очистка previous_status_id) устраняет причину; этот скрипт чинит уже залипшие заявки.
--
-- Затрагиваемые заявки: 803 (обычная стадия ОМТС) и 713 (под-стадия ОМТС-РП).
-- Аудит-безопасно: существующие approved-строки не трогаем, добавляем новую pending; идемпотентно
-- (повторный запуск ничего не сделает, если pending уже есть).
--
-- Запуск с сервера (под ролью с правом DML — billhub_runtime):
--   psql "$DATABASE_URL" -f scripts/repair-omts-approval-desync.sql

BEGIN;

-- 803: вернуть pending обычной стадии ОМТС
INSERT INTO approval_decisions (payment_request_id, stage_order, department_id, status, is_omts_rp)
SELECT pr.id, 2, 'omts', 'pending', false
FROM payment_requests pr
WHERE pr.request_number = '803'
  AND NOT EXISTS (SELECT 1 FROM approval_decisions ad
                  WHERE ad.payment_request_id = pr.id AND ad.status = 'pending');

-- 713: вернуть pending под-стадии ОМТС-РП
INSERT INTO approval_decisions (payment_request_id, stage_order, department_id, status, is_omts_rp)
SELECT pr.id, 2, 'omts', 'pending', true
FROM payment_requests pr
WHERE pr.request_number = '713'
  AND NOT EXISTS (SELECT 1 FROM approval_decisions ad
                  WHERE ad.payment_request_id = pr.id AND ad.status = 'pending');

-- Вернуть стадию согласования, снять ошибочные финальные метки, добавить аудит-запись в историю
UPDATE payment_requests
SET current_stage = 2,
    approved_at = NULL,
    previous_status_id = NULL,
    stage_history = COALESCE(stage_history, '[]'::jsonb) || jsonb_build_object(
      'event', 'repair', 'stage', 2, 'department', 'omts',
      'note', 'восстановлена pending-строка (расшивка рассинхрона статус/decisions)',
      'at', to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
WHERE request_number IN ('803', '713');

COMMIT;

-- Проверка после ремонта — запрос должен вернуть 0 строк:
-- SELECT pr.request_number, s.code
-- FROM payment_requests pr JOIN statuses s ON s.id = pr.status_id
-- WHERE s.code IN ('approv_shtab', 'approv_omts', 'approv_omts_rp')
--   AND pr.is_deleted = false AND pr.withdrawn_at IS NULL
--   AND NOT EXISTS (SELECT 1 FROM approval_decisions ad
--                   WHERE ad.payment_request_id = pr.id AND ad.status = 'pending');
