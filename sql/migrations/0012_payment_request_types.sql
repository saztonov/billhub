-- Миграция 0012: типы заявок на оплату (Подрядчик / Подрядчик Работа / Своя закупка).
--
-- Контекст:
--   В модалке «Новая заявка на оплату» вводится переключатель типа заявки. Тип определяет
--   набор видимых полей и путь согласования:
--     - contractor      — как раньше (цепочка Штаб → ОМТС);
--     - contractor_work  — без поставщика/срока/условий отгрузки, создаётся сразу «Согласовано»;
--     - own_purchase     — контрагент фикс. СУ-10 (генподрядчик), без срока поставки,
--                          создаётся сразу «Согласовано».
--   Для новых типов часть полей не заполняется → снимаем NOT NULL с delivery_days и
--   shipping_condition_id. Признак «генподрядчик» хранится в settings (ключ general_contractor):
--   если контрагент СУ-10 (ИНН 7736255508) уже есть в справочнике — линкуем его идемпотентно.
--
-- Без top-level BEGIN/COMMIT — runner оборачивает миграцию в транзакцию (ADR-0002).
-- Идемпотентность — через IF NOT EXISTS / DO-блоки / ON CONFLICT.

-- 1. Тип заявки + CHECK допустимых значений.
ALTER TABLE public.payment_requests
  ADD COLUMN IF NOT EXISTS request_type text NOT NULL DEFAULT 'contractor';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'payment_requests_request_type_check'
  ) THEN
    ALTER TABLE public.payment_requests
      ADD CONSTRAINT payment_requests_request_type_check
      CHECK (request_type IN ('contractor', 'contractor_work', 'own_purchase'));
  END IF;
END $$;

-- 2. Поля, не заполняемые новыми типами, делаем nullable.
ALTER TABLE public.payment_requests
  ALTER COLUMN delivery_days DROP NOT NULL,
  ALTER COLUMN shipping_condition_id DROP NOT NULL;

-- 3. Идемпотентный линк генподрядчика (СУ-10, ИНН 7736255508) в settings.
--    Если такого контрагента ещё нет — строка не вставляется, админ настроит через справочник.
--    Существующую настройку не перетираем (ON CONFLICT DO NOTHING).
INSERT INTO public.settings (key, value)
SELECT
  'general_contractor',
  jsonb_build_object('counterpartyId', c.id::text, 'name', c.name, 'inn', c.inn)
FROM public.counterparties c
WHERE c.inn = '7736255508'
ORDER BY c.created_at
LIMIT 1
ON CONFLICT (key) DO NOTHING;
