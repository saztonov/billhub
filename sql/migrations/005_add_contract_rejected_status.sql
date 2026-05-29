-- Миграция: добавить статус «Отклонено» для заявок на договоры
--
-- Для договоров (entity_type = 'contract_request') не было статуса «Отклонено».
-- Он нужен для кнопки «Отклонить», доступной ОМТС и админу на любом этапе
-- кроме «Заключен». Из «Отклонено» договор можно вернуть на «Согласование ОМТС».
--
-- Добавляем строку в таблицу statuses:
--   code = 'rejected', name = 'Отклонено', красный цвет.
-- display_order — следующий после максимального среди статусов договоров.
-- visible_roles — копируем у статуса 'concluded' (терминальный, виден тем же ролям).
-- Вставка идемпотентна: при повторном запуске дубликат не создаётся.

BEGIN;

INSERT INTO public.statuses (entity_type, code, name, color, is_active, display_order, visible_roles)
SELECT
  'contract_request',
  'rejected',
  'Отклонено',
  '#ff4d4f',
  true,
  (SELECT COALESCE(MAX(display_order), 0) + 1
     FROM public.statuses
    WHERE entity_type = 'contract_request'),
  (SELECT visible_roles
     FROM public.statuses
    WHERE entity_type = 'contract_request' AND code = 'concluded'
    LIMIT 1)
WHERE NOT EXISTS (
  SELECT 1 FROM public.statuses
   WHERE entity_type = 'contract_request' AND code = 'rejected'
);

COMMIT;
