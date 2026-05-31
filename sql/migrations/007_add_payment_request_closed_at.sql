-- Миграция: колонка payment_requests.closed_at (дата закрытия согласованной заявки)
--
-- Эндпоинт GET /api/approvals/ready-for-closure-count считает согласованные заявки
-- (approved_at IS NOT NULL), у которых ещё нет даты закрытия (closed_at IS NULL).
-- Колонка отсутствовала в схеме — запрос падал с 42703 (undefined_column). Добавляем
-- nullable timestamptz без значения по умолчанию: все существующие заявки считаются
-- незакрытыми (closed_at = NULL), что совпадает с прежним намерением эндпоинта.
--
-- Сама фича закрытия заявок (запись closed_at) появится позднее; здесь только колонка,
-- чтобы счётчик «готовы к закрытию» работал и совпадал на обеих реализациях репозитория.
-- Миграция считает предыдущие (001-006) уже применёнными. Без top-level BEGIN/COMMIT —
-- runner оборачивает execute-миграцию в транзакцию сам (ADR-0002).

ALTER TABLE public.payment_requests
  ADD COLUMN IF NOT EXISTS closed_at timestamp with time zone NULL;
