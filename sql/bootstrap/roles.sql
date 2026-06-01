-- =============================================================================
-- roles.sql — роли БД BillHub для Yandex Managed PostgreSQL (Iteration 8).
--
-- Применяется АДМИНИСТРАТОРОМ кластера ОДИН раз, ДО bootstrap-schema.sh, под
-- владельцем БД (в Yandex Managed PG — пользователь-владелец кластера). Создаёт двух
-- сервисных пользователей по принципу наименьших привилегий (стандарт v3 §7):
--
--   billhub_migration  — DDL+DML, только для migration runner (bootstrap-schema.sh,
--                        node dist/cli/migrate.js). CONNECTION LIMIT 5.
--   billhub_runtime    — ТОЛЬКО DML + EXECUTE функций public.*; БЕЗ CREATE/DROP/ALTER.
--                        CONNECTION LIMIT 30 (connection budget ADR-0005: 1 VPS × 2 процесса
--                        × pool.max=10 + reserve 5 = 25; ставим 30 с запасом).
--
-- ПАРОЛИ: замените оба CHANGE_ME на сильные случайные значения (32+ байт) ДО применения.
-- Пароли в этот файл НЕ коммитятся — задаются live администратором (Yandex Lockbox/секрет-менеджер).
--
-- Порядок: psql "<owner_url>" -v ON_ERROR_STOP=on -f sql/bootstrap/roles.sql
-- Затем bootstrap-schema.sh под billhub_migration наполняет схему и выдаёт гранты
-- на конкретные объекты (см. блок «гранты после bootstrap» ниже — применяется ПОВТОРНО
-- после bootstrap-schema.sh, т.к. объекты создаются именно там).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Пользователь миграций (DDL). Владеет создаваемыми объектами схемы public.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'billhub_migration') THEN
    CREATE ROLE billhub_migration LOGIN PASSWORD 'CHANGE_ME' CONNECTION LIMIT 5;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 2. Пользователь runtime (DML + EXECUTE). НЕ может менять схему.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'billhub_runtime') THEN
    CREATE ROLE billhub_runtime LOGIN PASSWORD 'CHANGE_ME' CONNECTION LIMIT 30;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 3. Базовые права на схему public.
--    USAGE — обоим. CREATE — только миграционному (создаёт таблицы/функции).
-- ---------------------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO billhub_migration, billhub_runtime;
GRANT CREATE ON SCHEMA public TO billhub_migration;
-- Явно отзываем CREATE у runtime (на случай унаследованного PUBLIC-гранта на public).
REVOKE CREATE ON SCHEMA public FROM billhub_runtime;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- 4. DEFAULT PRIVILEGES: всё, что billhub_migration СОЗДАСТ в public (через
--    bootstrap-schema.sh и migrate.js), автоматически получает гранты для runtime.
--    Это ключевой блок — он покрывает объекты, создаваемые ПОСЛЕ применения roles.sql.
-- ---------------------------------------------------------------------------
ALTER DEFAULT PRIVILEGES FOR ROLE billhub_migration IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO billhub_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE billhub_migration IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO billhub_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE billhub_migration IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO billhub_runtime;

-- billhub_runtime НЕ получает права на тип DDL (TYPES/SCHEMAS) — только данные и функции.

-- ---------------------------------------------------------------------------
-- 5. Гранты на УЖЕ существующие объекты (если roles.sql применяется ПОВТОРНО
--    после bootstrap-schema.sh — например, при пересоздании runtime-пользователя).
--    При первом применении на пустой public эти команды — no-op.
--    Безопасно идемпотентны.
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO billhub_runtime;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO billhub_runtime;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO billhub_runtime;

-- ---------------------------------------------------------------------------
-- ПРОВЕРКА (запустить вручную после bootstrap):
--   SELECT rolname, rolconnlimit FROM pg_roles
--    WHERE rolname IN ('billhub_runtime','billhub_migration');
--   -- billhub_runtime → 30, billhub_migration → 5
--
--   -- runtime НЕ должен иметь CREATE на public:
--   SELECT has_schema_privilege('billhub_runtime','public','CREATE');  -- ожидается f
--   -- runtime ДОЛЖЕН иметь EXECUTE на нумераторе:
--   SELECT has_function_privilege('billhub_runtime',
--          'public.generate_request_number(text)','EXECUTE');          -- ожидается t
-- ---------------------------------------------------------------------------
