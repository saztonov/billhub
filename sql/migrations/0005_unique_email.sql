-- Миграция 0005: регистронезависимая уникальность email в public.users (Этап 1, VPS2).
--
-- Контекст: в облачном Supabase уникальность email гарантировал Supabase Auth (auth.users).
-- В standalone-режиме (собственная авторизация на Yandex PG) этой гарантии больше нет — в
-- public.users есть только обычный индекс users_email_idx (без UNIQUE). Batch-import подрядчиков
-- и любые будущие регистрации требуют защиты от дублей на уровне БД (иначе — два аккаунта на один
-- email, неоднозначный логin).
--
-- Решение: функциональный УНИКАЛЬНЫЙ индекс на lower(email). Тип колонки не меняется; уникальность
-- регистронезависимая ('User@x' и 'user@x' считаются одним email).
--
-- ВАЖНО (readiness-gate перед cutover): если в переносимых данных есть регистронезависимые дубли
-- email, создание индекса (при bootstrap) ИЛИ восстановление данных (pg_restore, шаг 04) упадёт.
-- Дубли нужно устранить в источнике ДО окна. Диагностика на Supabase:
--   SELECT lower(email) AS e, count(*) FROM public.users GROUP BY 1 HAVING count(*) > 1;
--
-- Без top-level BEGIN/COMMIT — runner оборачивает миграцию в транзакцию (ADR-0002). Поэтому
-- CREATE INDEX CONCURRENTLY недопустим; обычный CREATE UNIQUE INDEX держит короткую блокировку —
-- приемлемо (в окне на bootstrap таблица пуста). Идемпотентность — через IF NOT EXISTS.

CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_unique_idx
  ON public.users (lower(email));
