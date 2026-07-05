---
name: skill_keycloak_billhub
description: >-
  Миграция аккаунтов BillHub в корпоративный Keycloak (realm su10) и доводка уже существующей
  keycloak-режим авторизации (grant-only, AUTH_MODE=keycloak). Использовать при: массовом импорте
  public.users в Keycloak, cutover standalone→keycloak и обратном откате, доработке резолва
  идентичности/гейта доступа, реализации регистрации подрядчиков по Варианту B, reconcile
  групп/линков, подготовке переезда внутренних пользователей на AD. Триггеры: «миграция в keycloak»,
  «bulk import пользователей», «cutover keycloak», «reconcile группы/линки», «provision через
  Admin API», «register-counterparty», «bcrypt в keycloak».
---

# Миграция BillHub → Keycloak (realm su10)

Скилл для миграции всех аккаунтов BillHub в корпоративный Keycloak и доводки keycloak-режима.
Опирается на УЖЕ СУЩЕСТВУЮЩУЮ реализацию (коммит `5e2f159`, grant-only) — не переписывать с нуля.

## Факт на старте (сверять, не предполагать)

**Что уже есть в BillHub (grant-only):**

- `AUTH_MODE=keycloak` — OIDC Authorization Code + PKCE, паттерн BFF (токены только в httpOnly-cookie).
- `server/src/routes/auth-keycloak.ts` — `resolveOrOnboard` (резолв на callback).
- `server/src/services/auth/keycloak/admin-client.ts` — Admin REST: **только чтение юзеров + перекладывание групп** (нет create-user/set-password/partialImport).
- `server/src/middleware/authenticate.ts::authenticateKeycloak` — гейт по группе `billhub-active` из токена + резолв профиля через `user_identity_links` → `users`.
- `server/src/services/auth/stores/pg.ts::DrizzleIdentityLinkStore` — идемпотентная линковка (onConflictDoNothing по `(provider,subject)`).
- `sql/migrations/0009_keycloak_identity_links.sql` — таблица `user_identity_links(provider, subject text, user_id, email_at_link)`, UNIQUE `(provider,subject)`.
- `server/src/config.ts` — `authMode`, `OIDC_*`, `KC_ADMIN_*`, `KC_PORTAL_GROUP_*`, `AUTH_IDENTITY_PROVIDER` (дефолт `keycloak-local`).
- `server/src/services/auth/password.service.ts` — bcrypt **cost 12**, `isBcryptHash` (`$2[aby]$NN$`).
- `server/src/cli/import-passwords.ts` — перенос Supabase→standalone `users.password_hash` (**не** Keycloak) + `listNullPasswordUsers()`.

**Что уже развёрнуто в контуре su10** (доки billhub про «Этап 2, не подключён» — УСТАРЕЛИ):

- `https://auth.su10.ru/realms/su10` (KC 26.1.5) живой; клиент `billhub` (confidential, PKCE S256, мапперы email/preferred_username/audience/Group-Membership `groups`); сервис-аккаунт `view-users`+`manage-users`; группы `billhub-pending`/`billhub-active`.
- `registrationAllowed=false`, `verifyEmail=false`, `resetPasswordAllowed=false`, **SMTP нет**.

**Чего НЕТ (блокеры):**

- bcrypt `PasswordHashProvider` в Keycloak (без него перенесённые bcrypt-хэши не проверятся).
- Кода массового импорта (`partialImport`) — только runbook `docs/keycloak-billhub.md §6`.
- Провижининга пользователей через Admin API (`admin-client` не создаёт юзеров), а `registrationAllowed=false` ⇒ self-registration больше не работает.

## Жёсткие инварианты (не нарушать)

1. `users.id` неизменен (≈29-31 FK, вся история). Импорт в KC с `id=users.id`.
2. Реальный KC `sub` каждого → `user_identity_links(provider='keycloak-local', subject=sub, user_id=users.id, email_at_link)`. `ifResourceExists:SKIP` НЕ гарантирует `sub=users.id` — перечитывать реальный sub, при несовпадении стоп (кроме approved-mapping).
3. Роль и `counterparty_id` — из БД BillHub; client-роли из токена игнорировать.
4. bcrypt-хэши как есть (`$2[aby]$NN$`, cost 12), пароли не сбрасывать; null-хэш → без credentials; `emailVerified=true` всем.
5. Откат на standalone обязан оставаться возможным: `password_hash`/standalone-код/refresh-таблицы не удалять до конца окна отката.

## Предпосылка №0 (в репозитории `auth`, ВНЕ billhub — но без неё импорт бессмыслен)

- Собрать bcrypt `PasswordHashProvider` (KC 26.1/Quarkus) в `keycloak/providers/`.
- В `keycloak/realm/su10-realm.yaml` добавить protocol-mapper user-attribute **`billhub_user_id`** в access+id token у клиента `billhub`.
- **Доказать формат credential** (`secretData`/`credentialData`) на ОТДЕЛЬНОМ тест-realm (вход старым паролем → перехэш в argon2). Payload-builder в BillHub писать ТОЛЬКО под доказанный контракт.
- Отдельные import-креды с ролью `manage-realm` (отдельный `client_credentials`-клиент или realm-admin) — **не** сервис-аккаунт `billhub` (у него только manage-users; `partialImport` требует manage-realm).
- Сверить `OIDC_CLIENT_SECRET` billhub с секретом, который config-cli взял из `.env` (`BILLHUB_CLIENT_SECRET`).

## Развилка (выбрать явно, не менять молча): источник истины авторизации

Гейт сейчас — членство в `billhub-active` из токена (позволяет активацию из KC-консоли, §2 доки).

- **Вариант A (рекомендую):** гейт остаётся групповым в реалтайме; `users.is_active` — авторитет, приводящий группы в соответствие через `reconcile`; НЕ добавлять per-request DB-гейт. KC-console-активация сохраняется.
- **Вариант B (fail-closed):** требовать И `billhub-active` И `users.is_active`; активация ТОЛЬКО через billhub-админку (ставит оба); KC-console-активация без sync доступа не даёт — задокументировать потерю функции.

Не добавлять проверку `is_active` в гейт «просто так» — это меняет семантику двойной активации.

## Работы (фазы)

### Ф1. Identity-model hardening

- Резолв сделать provider-agnostic, порядок: (1) claim `billhub_user_id` из verified JWT → `users.findById`; (2) `user_identity_links` по `(provider, subject)` среди `['keycloak-ad','keycloak-local']`; (3) email-fallback ТОЛЬКО для verified email и ТОЛЬКО как **аварийный/диагностический** путь (после массового импорта линки уже записаны — fallback почти не должен срабатывать; логировать WARN + метрика).
- Убрать жёсткую завязку резолва/гейта на глобальный `AUTH_IDENTITY_PROVIDER`.
- Поддержать несколько провайдеров на один `users.id`; при первом входе через новый provider (AD) перелинковать **по `billhub_user_id`** (не по email) и **перенести** членство `billhub-active` на новый sub.
- Опц. `unique(provider, user_id)` — только после проверки, что текущие данные её не нарушают.
- Инвалидировать 15-сек user-cache при активации/деактивации/смене профиля.

### Ф2. Registration Variant B (регистрация на IdP закрыта)

- Заменить self-registration flow (`/register?token` → `/api/auth/login?regToken`). Добавить public `POST /api/auth/register-counterparty {token,email,fullName,password}`: валидирует counterparty-token и пароль-полиси → создаёт KC-юзера через Admin API (`enabled`, `emailVerified=true`, attribute `billhub_user_id=users.id`, credentials из пароля) → `billhub-pending` → локальный `users` (inactive) + link → фронт отправляет на обычный KC-login. Идемпотентность по email.
- `POST /api/users` (admin-create) в keycloak-режиме ТОЖЕ провижинит KC-идентичность сразу (create + attribute + группа + link), а не ждёт первого входа (иначе при закрытой регистрации юзер никогда не войдёт).
- В `admin-client.ts` добавить `createUser`/`setPassword`/`setUserAttribute`; переиспользовать в обоих путях.

### Ф3. Bulk import CLI `server/src/cli/migrate-to-keycloak.ts` (режимы `preflight|import|verify|reconcile|report`)

- **preflight** (только чтение, отчёт): дубли `lower(email)`; null/невалидные bcrypt; инварианты role/counterparty; уже существующие в KC по email; будущие sub/email конфликты. Отказ старта при аномалиях выше порога (`--allow-anomalies N`).
- **import** батчами: `POST /admin/realms/su10/partialImport` (`ifResourceExists=SKIP`); payload на юзера: `{id:users.id, username:email, email, emailVerified:true, enabled:true, attributes:{billhub_user_id:[users.id]}, credentials:[bcrypt→{algorithm:bcrypt, hashIterations:<cost из хэша>, …по доказанному SPI-контракту}] | null-хэш→без credentials}`.
- после каждого батча: найти реального юзера по **email exact** (и/или атрибуту `billhub_user_id`); если это был SKIP пред-существующего — до-проставить attribute через `PUT /users/{id}`; взять реальный sub; `sub!=users.id` → в отчёт mismatch и **СТОП**, продолжение только через **approved-mapping файл** (`users.id→sub`, ревью ops); иначе upsert `user_identity_links` (onConflictDoNothing).
- группы: `is_active` → `billhub-active`, иначе `billhub-pending`.
- restart-safe: `--dry-run`; checkpoint/resume (курсор по `users.id`); ретраи/таймауты/рейт-лимит Admin API; **не логировать пароли/хэши/токены**. Финальный отчёт: imported/skipped(null)/skipped(dup)/mismatch/linked/active/pending; `exit!=0` при любом mismatch или неполном переносе.
- **reconcile**: сверить БД(`is_active`) ↔ KC-группы ↔ links ↔ `billhub_user_id`; чинить дрейф по выбранному источнику истины (Ф-развилка) или hard-fail отчёт. Неуспешные Admin-API вызовы — не «успех»: писать в outbox/лог-ретраев (сейчас сбой `addPortalPending` только логируется).

### Ф4. Прод-готовность и доки

- Разрешить `AUTH_MODE=keycloak` в startup-checks + readiness (discovery/JWKS доступны).
- Обновить `docs/keycloak-billhub.md`: Keycloak уже развёрнут (не «Этап 2»); Вариант B (регистрация закрыта, провижининг через Admin API, отдельный pre-login endpoint); явно развести подрядчик (постоянно local) / сотрудник (временно local→AD, перелинк по `billhub_user_id`); пробел SMTP (verify/reset недоступны, null-hash → admin-процедура); `partialImport` требует manage-realm.
- Проверить скрипты, ожидающие миграции «до 0005»/`EXPECTED_NEW` (появился 0009).

## Тест-план

- (auth-repo) SPI на тест-realm: `$2a/$2b/$2y`, cost из хэша, первый вход → argon2.
- (unit) payload-builder; bcrypt-parser; preflight-аномалии; approved-mapping; null-хэш; дубль email.
- (интеграция) резолв по `billhub_user_id`; email-fallback только для verified; выбранный источник истины (Ф-развилка).
- (CLI, mock KC Admin) dry-run без записей; resume идемпотентен; mismatch→стоп; reconcile чинит группы.
- (E2E canary) вход admin/user/security/counterparty; scoping подрядчика; активация/деактивация; откат keycloak→standalone (standalone-данные сохранены).

## Безопасность

- Секреты/хэши не логировать и не коммитить; `partialImport` под manage-realm, не под сервис-аккаунтом billhub.
- Сначала прогон на ОТДЕЛЬНОМ тест-realm, потом su10. Backup БД + realm-export перед импортом. Зафиксировать метку cutover.
