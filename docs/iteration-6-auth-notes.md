# Iteration 6 — отложенные auth-операции (заметки для промпта)

Этот документ собирает операции, завязанные на **Supabase Auth** (`supabase.auth.*`), которые в
Iteration 5 НЕ переводились на DrizzleRepository, потому что их корректный эквивалент — это
standalone-auth (`users.password_hash` + bcrypt, refresh-токены, reset), вводимый в Iteration 6.

При подготовке промпта Iteration 6 учесть все пункты ниже.

## Отложенные эндпоинты и операции

### `server/src/routes/users.ts` — `POST /api/users/batch-import`
- Что делает на Supabase Auth: `supabase.auth.admin.createUser({ email, password, email_confirm: true })`,
  затем вставляет строку в `users` с `id = authData.user.id`, `role = 'counterparty_user'`, `counterparty_id`.
- Назначение: массовое создание пользователей-подрядчиков (по одной записи с фронта).
- Standalone-эквивалент (Iteration 6): генерация `id` (uuid), запись `users.password_hash = bcrypt(password)`,
  `password_changed_at`, без обращения к Supabase Auth. Должно идти через UserRepository.createCounterpartyUser()
  в `db.transaction()` (создание users + при необходимости audit-event).
- На время Iteration 5 эндпоинт ОСТАВЛЕН на `supabase.auth.admin` как явное исключение
  (DB-часть `users` insert тоже временно остаётся рядом, т.к. неотделима от auth-создания).

### `server/src/routes/auth.ts` — весь файл
- Полностью завязан на Supabase Auth (вход, сессии, проверка пароля и т.п.) — 15 обращений к Supabase.
- Переводится в Iteration 6 целиком на standalone-auth (раздел 13 плана: bcrypt-сравнение с
  `users.password_hash`, refresh rotation + reuse detection, CSRF, rate-limits, password reset).
- В Iteration 5 НЕ трогается.

## Трактовка gate Iteration 5

Gate `grep fastify.supabase` для Iteration 5 трактуется как «нет прямых `.from()/.rpc()` в роутах».
Обращения к `supabase.auth.*` в `users.ts` (batch-import) и весь `auth.ts` — задокументированное
исключение до Iteration 6.

## Прочие связанные данные

- Импорт паролей подрядчиков: bcrypt-хэши из `auth.users.encrypted_password` → `users.password_hash`
  (скрипт `import-passwords.ts`, см. план Iteration 6 / Iteration 9).
- Денормализация и роли: `users.role` ∈ {admin, user, counterparty_user, security}; `counterparty_id`
  только у `counterparty_user`.
