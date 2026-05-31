-- Миграция 0008: standalone auth (стандарт v3 раздел 13, план Iteration 6).
--
-- ВНИМАНИЕ по нумерации: план/постановка ссылались на «0007_auth_standalone.sql»,
-- но версия 7 уже занята применённой миграцией 007_add_payment_request_closed_at.sql
-- (Iteration 5). Migration-runner (server/src/cli/migrate.ts) запрещает дублирующиеся
-- номера версий, поэтому auth-миграция получает СЛЕДУЮЩИЙ свободный номер — 0008.
-- Принцип 6 (SQL-first, checksum, нельзя править применённые миграции) соблюдён.
--
-- Что добавляется:
--   1. users.password_hash / password_changed_at / email_hmac — bcrypt-хэш из
--      auth.users.encrypted_password переносится скриптом import-passwords.ts (Iteration 9/10).
--      password_hash NULLABLE: на момент применения существующие строки ещё без хэша
--      (заполняются импортом). Standalone-login требует непустой password_hash.
--   2. refresh_tokens — rotation + reuse detection (family_id, replaced_by, revoked_at).
--   3. password_reset_tokens — запрос/подтверждение сброса пароля (token_hash, used_at).
--
-- Расширения: gen_random_uuid() доступна (используется во всех PK-дефолтах схемы).
-- Тип inet — встроенный, расширения не требует.
--
-- Без top-level BEGIN/COMMIT — execute-миграцию runner оборачивает в транзакцию сам
-- (ADR-0002; иначе TransactionControlError). Идемпотентность через IF NOT EXISTS.

-- 1. Колонки аутентификации в users -----------------------------------------
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS password_hash       text        NULL,
  ADD COLUMN IF NOT EXISTS password_changed_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS email_hmac          text        NULL;

COMMENT ON COLUMN public.users.password_hash IS
  'bcrypt-хэш пароля ($2a/$2b/$2y). Переносится из auth.users.encrypted_password (import-passwords.ts).';
COMMENT ON COLUMN public.users.email_hmac IS
  'HMAC-SHA256 нормализованного email (AUDIT_HMAC_KEY) для псевдонимизации в audit_log и ключах rate-limit.';

-- Индекс по email для логина (standalone находит пользователя по email).
CREATE INDEX IF NOT EXISTS users_email_idx ON public.users (email);

-- 2. refresh_tokens (rotation + reuse detection) ----------------------------
CREATE TABLE IF NOT EXISTS public.refresh_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  token_hash  text NOT NULL,
  family_id   uuid NOT NULL,
  issued_at   timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  replaced_by uuid NULL REFERENCES public.refresh_tokens(id) ON DELETE SET NULL,
  revoked_at  timestamptz NULL,
  ip          inet NULL,
  user_agent  text NULL
);

-- Поиск токена при обмене — по hash (уникален: коллизия hash = нарушение инварианта).
CREATE UNIQUE INDEX IF NOT EXISTS refresh_tokens_token_hash_key
  ON public.refresh_tokens (token_hash);
CREATE INDEX IF NOT EXISTS refresh_tokens_user_id_idx
  ON public.refresh_tokens (user_id);
CREATE INDEX IF NOT EXISTS refresh_tokens_family_id_idx
  ON public.refresh_tokens (family_id);
-- Retention-cron (Iteration 7): удаление revoked/expired старше 30 дней.
CREATE INDEX IF NOT EXISTS refresh_tokens_expires_revoked_idx
  ON public.refresh_tokens (expires_at, revoked_at);

-- 3. password_reset_tokens --------------------------------------------------
CREATE TABLE IF NOT EXISTS public.password_reset_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  token_hash  text NOT NULL,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS password_reset_tokens_token_hash_key
  ON public.password_reset_tokens (token_hash);
CREATE INDEX IF NOT EXISTS password_reset_tokens_user_id_idx
  ON public.password_reset_tokens (user_id);
