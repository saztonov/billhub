# Подключение BillHub к Keycloak (realm su10) — операционная инструкция

Руководство по подключению портала **BillHub** как ещё одного клиента в **уже развёрнутый**
корпоративный Keycloak контура su10 (realm `su10`, `auth.su10.ru`, KC 26.1.5). Аутентификация —
OIDC Authorization Code + PKCE, паттерн BFF (браузер токенов не видит, всё в httpOnly-cookie).
Образец инфраструктуры — `EstiMat/deploy/infra-keycloak/README.md` (клиент `estimat`).

Этот документ — **единственный операционный источник истины** по подключению BillHub к Keycloak.
Целевая модель — из скилла `.claude/skills/skill_keycloak_billhub/SKILL.md`. Часть шагов уже доступна
(инфра Keycloak развёрнута), часть — **зависит от кода BillHub, который ещё не написан**; такие шаги
помечены статусом **[после Ф1 / после Ф2 / после Ф3]**. Не выполняйте помеченные шаги как готовый
runbook — сперва должен появиться соответствующий код.

Секреты (client secret, пароли БД) — только в `/etc/billhub/*.env` (права 640), в чат/логи не выводить.

## Статус реализации (сейчас / что осталось)

- **Grant-only keycloak-режим реализован ЧАСТИЧНО** (коммит `5e2f159`): OIDC/PKCE/BFF, гейт по группе
  `billhub-active`, резолв через `user_identity_links`, переключение групп через Admin API.
- **Развёрнуто в su10:** клиент `billhub` (confidential, PKCE S256, мапперы email/preferred_username/
  audience/Group-Membership), сервис-аккаунт `view-users`+`manage-users`, группы `billhub-pending`/
  `billhub-active`. `registrationAllowed=false`, `verifyEmail=false`, `resetPasswordAllowed=false`,
  **SMTP нет**.
- **Готово в репозитории `auth` (Предпосылка №0), но НЕ накачено на su10:** bcrypt `PasswordHashProvider`
  (доказан на тест-realm), mapper `billhub_user_id` + user-profile (см. §1).
- **Ещё НЕТ в коде BillHub:** провижининг через Admin API и endpoint `register-counterparty` (Ф2);
  массовый импорт-CLI `migrate-to-keycloak.ts` (Ф3); provider-agnostic резолв по `billhub_user_id` (Ф1);
  снятие startup-инварианта для прод-включения (Ф4).

## 0. Предпосылки

- Realm `su10` поднят, discovery отвечает:
  `https://auth.su10.ru/realms/su10/.well-known/openid-configuration`.
- Админ-консоль `https://auth-admin.su10.ru` (VPN/allowlist).
- Домены BillHub (same-origin, `/api` на том же origin): `rp.su10.ru`, `ravek.link`, `www.ravek.link`.

## 1. Клиент `billhub`

Clients → Create client:
- Client type **OpenID Connect**, Client ID `billhub`.
- **Client authentication: On** (confidential); **Standard flow: On**; Direct access grants: Off.
- **PKCE**: Advanced → Proof Key for Code Exchange = **S256**.
- **Valid redirect URIs** (точные, без `*`):
  - `https://rp.su10.ru/api/auth/oidc/callback`
  - `https://ravek.link/api/auth/oidc/callback`
  - `https://www.ravek.link/api/auth/oidc/callback`
- **Valid post-logout redirect URIs** и **Web origins** — те же три домена (без `*`).
- Advanced → **Login theme = `billhub`** (см. `deploy/keycloak-theme/billhub/README.md`).
- Credentials → скопировать **Client secret** → `OIDC_CLIENT_SECRET` в `/etc/billhub/runtime.env`.

### Мапперы клиента (Client scopes → billhub-dedicated → Mappers)
- **email**, **preferred_username** (обычно из base scopes — убедиться, что попадают в токен).
- **Audience**: добавить `billhub` в `aud` (Add mapper → By configuration → Audience →
  Included Client Audience = `billhub`).
- **Group Membership**: Add mapper → Group Membership; Token Claim Name = `groups`;
  Full group path — по желанию (бэкенд принимает и имя, и путь `/<name>`); Add to access token = On.
- **`billhub_user_id`** (user-attribute mapper, claim в access+id+userinfo) — стабильный correlation-key
  идентичности (нужен для provider-agnostic резолва и будущего перелинка local→AD). Заведён в
  realm-as-code репо `auth` (`keycloak/realm/su10-realm.yaml`).
- **Client-роли в токен НЕ добавлять** — роли/контрагент берутся из БД BillHub.

### User-profile: атрибут `billhub_user_id`
⚠️ **KC 26 отбрасывает неописанные (unmanaged) атрибуты.** Атрибут `billhub_user_id`, выставленный при
import/create через Admin API, **молча теряется**, если он не объявлен в user-profile realm — тогда
claim `billhub_user_id` пуст и резолв-по-claim не работает.

- `billhub_user_id` объявлен **управляемым admin-only атрибутом** в `auth/keycloak/realm/su10-userprofile.json`.
- ⚠️ **config-cli 6.x секцию `userProfile` НЕ применяет** (adorsys config-cli #979) — user-profile
  накатывается **отдельным прямым Admin API PUT** через `auth/keycloak/realm/apply-userprofile.sh`
  (шаг в `deploy-auth.sh` **после** config-cli).
- Связка (mapper + user-profile) **доказана** на тест-realm `up-poc` (`verify-userprofile-poc.sh`,
  2026-07-05): атрибут сохраняется, claim попадает в токен.
- **Накат на su10 — два шага:** config-cli (mapper) + `apply-userprofile.sh` (user-profile). Сперва
  dry-run/тест-realm (меняет user-profile живого realm). **Оба наката обязательны ДО** массового импорта
  (§6) и Admin-API провижининга (§3), иначе `billhub_user_id` теряется.

### Сервис-аккаунт и import-креды (Admin REST)
- Сервис-аккаунт клиента `billhub`: Service accounts roles On, права **читать пользователей** и
  **управлять членством в группах** (`view-users`, `manage-users` из `realm-management`). Используется
  рантаймом для линковки и активации (перевод групп).
- ⚠️ Для **массового импорта** (`partialImport`, §6) нужны **отдельные import-креды с ролью
  `manage-realm`** — отдельный `client_credentials`-клиент или realm-admin. Сервис-аккаунт `billhub`
  (только `manage-users`) для `partialImport` **не годится**.
- Если для Admin REST используется отдельный клиент — задать `KC_ADMIN_CLIENT_ID`/
  `KC_ADMIN_CLIENT_SECRET`; иначе берётся клиент `billhub`.

## 2. Группы портала и источник истины доступа

Groups → создать (уже созданы в su10):
- **`billhub-pending`** — доступ заведён, не активен.
- **`billhub-active`** — доступ активен.

**Источник истины доступа — членство в KC-группе `billhub-active`** (решено). Гейт бэкенда
(`authenticateKeycloak`) читает группу из токена и пускает только при `billhub-active`. Доступ выдаётся
с двух сторон и всегда пишется в эту KC-группу:
- **админ Keycloak** — Users → пользователь → Groups → добавить в `billhub-active`;
- **админ BillHub** — Администрирование → Пользователи → переключатель «Активен» (через Admin API
  `setPortalActive` двигает ту же группу). **[после Ф1: group-first в UsersTab]**

В keycloak-режиме `users.is_active` — **не авторитет доступа**, максимум неавторитетное зеркало для UI.
Статус активности в админке BillHub следует читать из Keycloak (членство в группе); при использовании
зеркала — синхронизировать `reconcile` направлением **KC → БД**. В гейт `is_active` не добавляется.

⚠️ **Задержка активации:** смена группы вступает в силу на **следующем токене** (login/refresh), т.к.
группа — в подписанном access-токене. 15-сек user-cache бэкенда кеширует только профиль (роль/контрагент),
не claim `groups` — на скорость гейта не влияет. Короткий TTL access + refresh подхватывают.

⚠️ **Failure-mode активации (цель, Ф1):** если Keycloak Admin API недоступен, запрос активации/деактивации
должен падать или уходить в outbox/лог-ретраев — **не** писать зеркало `is_active` при неудачной записи в
KC (иначе БД и KC разъезжаются).

## 3. Регистрация подрядчиков — Вариант B (регистрация на IdP закрыта) [после Ф2]

В su10 `registrationAllowed=false` — **само-регистрация в Keycloak не работает** и не включается.
Подрядчик заводится по **Варианту B** (провижининг через Admin API):

1. Подрядчик открывает регистрационную ссылку контрагента в BillHub (по
   `counterparties.registration_token`) → BillHub-форма (email, ФИО, пароль).
2. `POST /api/auth/register-counterparty {token,email,fullName,password}` — валидирует
   counterparty-token и пароль-политику → через Admin API создаёт KC-пользователя:
   `enabled`, `emailVerified=true`, `firstName`/`lastName` (обязательны — см. §6),
   attribute `billhub_user_id=users.id`, credentials из пароля → группа `billhub-pending`.
3. В той же операции — локальная строка `users` (роль `counterparty_user`, контрагент из токена,
   `is_active=false`-зеркало) + `user_identity_links`. Идемпотентность по email; при частичном сбое
   (KC создан, локально упало) — компенсация/cleanup; анти-enumeration (единый ответ), rate-limit.
4. Фронт отправляет на обычный KC-login. Активация — админом (§2).

⚠️ **Эндпоинта `register-counterparty` ещё нет в коде** (Ф2). До его реализации подрядчик через
закрытый IdP завестись не может. `POST /api/users` (admin-create) в keycloak-режиме также должен
провижинить KC-идентичность сразу (create + attribute + группа + link), а не ждать первого входа.

## 4. bcrypt-провайдер (перенос паролей) — ГОТОВО (репо `auth`)

Keycloak «из коробки» проверяет только native-алгоритм (argon2 на KC26 non-FIPS). Для приёма
перенесённых bcrypt-хэшей нужен `PasswordHashProvider`.

- ✅ **Собран и доказан** (внешний артефакт репо `auth`, не billhub): `keycloak/providers/bcrypt-spi/`
  (id `bcrypt`, KC 26.1.5, at.favre шейдится); JAR → `/opt/keycloak/providers`, `kc.sh build`, рестарт.
- ✅ **Формат доказан 2026-07-05** на тест-realm `bcrypt-poc` (`bcrypt-spi/verify-bcrypt-poc.sh`): вход
  `$2a/$2b/$2y` cost 12/10 → перехэш в argon2; приняты **оба пути** — `partialImport` и Admin-API
  create-user. Точный формат `secretData`/`credentialData` — в
  `auth/keycloak/providers/CREDENTIAL_CONTRACT.md`; payload-builder BillHub писать строго под него.
- Realm password policy — дефолт (argon2); провайдер нужен только для проверки импортированных кредов,
  первый вход перехэширует пароль в argon2. Держать провайдер, пока все активные не перехэшируются.
- На su10 JAR инертен (пока нет пользователей с bcrypt-кредами).

## 5. Переменные окружения BillHub

`/etc/billhub/runtime.env` (значения — не в git; применять только пересозданием контейнеров `up -d`).

**Текущие (используются сейчас) — OIDC + рантайм-Admin:**
```
AUTH_MODE=keycloak
OIDC_ISSUER=https://auth.su10.ru/realms/su10
OIDC_CLIENT_ID=billhub
OIDC_CLIENT_SECRET=<из Credentials>
OIDC_REDIRECT_URI=https://rp.su10.ru/api/auth/oidc/callback
OIDC_POST_LOGOUT_REDIRECT_URI=https://rp.su10.ru/login
OIDC_SCOPES=openid email profile
# Admin REST (если не указано — base/realm выводятся из issuer, клиент = OIDC_CLIENT_*):
KC_ADMIN_BASE_URL=https://auth.su10.ru
KC_ADMIN_REALM=su10
KC_ADMIN_CLIENT_ID=billhub
KC_ADMIN_CLIENT_SECRET=<секрет сервис-аккаунта>
KC_PORTAL_GROUP_PENDING=billhub-pending
KC_PORTAL_GROUP_ACTIVE=billhub-active
# Для отката на standalone держать заданными (не dev-заглушки):
AUTH_JWT_SECRET=<...>
CSRF_SECRET=<...>
AUDIT_HMAC_KEY=<...>
```

**Будущие (import-only, для CLI Ф3) — отдельные `manage-realm`-креды, не сервис-аккаунт billhub:**
```
# отдельный client_credentials-клиент или realm-admin с ролью manage-realm (для partialImport)
KC_IMPORT_CLIENT_ID=<...>
KC_IMPORT_CLIENT_SECRET=<...>
```

⚠️ **Прод-включение `AUTH_MODE=keycloak` заблокировано кодом:** startup-инвариант
`checkAuthModeInvariant` (`server/src/services/observability/startup-checks.ts`) требует в production
`AUTH_MODE=standalone`. Снятие блока — работа **Ф4** (разрешить `keycloak` в startup-checks + readiness).

## 6. Массовый перенос существующей базы аккаунтов [после Ф3]

Переносится **вся** `public.users` (сотрудники + текущие подрядчики) — идентичности и **bcrypt-хэши
паролей** (пароли не сбрасываются). Целевой инструмент — CLI
`server/src/cli/migrate-to-keycloak.ts` (режимы `preflight|import|verify|reconcile|report`).

⚠️ **CLI ещё нет в коде** (Ф3) — до его реализации массовый перенос невозможен.
⚠️ **Предусловие:** mapper `billhub_user_id` + user-profile применены к su10 (config-cli +
`apply-userprofile.sh`, §1), иначе атрибут `billhub_user_id` в payload теряется.

Режимы:
- **preflight** (только чтение): backup БД + realm-export; дубли `lower(email)`; null/невалидные
  bcrypt (`$2[aby]$12$`); инварианты role/counterparty; уже существующие в KC по email; будущие
  sub/email-конфликты. Отказ при аномалиях выше порога (`--allow-anomalies N`). Зафиксировать метку
  cutover.
- **import** батчами: `POST /admin/realms/su10/partialImport` (`ifResourceExists=SKIP`, `id=users.id`).
  Payload на юзера: `id=users.id`, `username`/`email`, `emailVerified=true`, `enabled=true`,
  **обязательные `firstName`/`lastName`** (стабильный split `full_name` + fallback — иначе VERIFY_PROFILE
  ломает вход `Account is not fully set up`; исходный `full_name` — доп. KC-attribute для reconcile-сверки,
  тоже объявлен в user-profile), `attributes.billhub_user_id=[users.id]`, credentials — bcrypt строго по
  `CREDENTIAL_CONTRACT.md` (`type:password`, `secretData={"value":"<полный $2…>"}`,
  `credentialData={"hashIterations":<cost из хэша>,"algorithm":"bcrypt"}`); null-хэш → без credentials.
- **Группы и линки**: прочитать **фактический** KC-id по email exact (и/или атрибуту `billhub_user_id`);
  SKIP не гарантирует `sub=users.id` — при mismatch стоп, продолжение только через approved-mapping файл
  (`users.id→sub`, ревью ops). Активных → `billhub-active`, иначе `billhub-pending`; записать
  `user_identity_links` (`provider=keycloak-local, subject=<реальный sub>, user_id, email_at_link`).
- **verify/reconcile/report**: сверка KC-группы (источник истины) ↔ БД-зеркало ↔ links ↔ `billhub_user_id`;
  приведение зеркала направлением **KC→БД**; неуспешные Admin-API вызовы — в outbox/лог-ретраев, не «успех».
- restart-safe: `--dry-run`, checkpoint/resume (курсор по `users.id`), ретраи/рейт-лимит; пароли/хэши/
  токены не логировать; `exit!=0` при любом mismatch или неполном переносе.

## 7. Смена пароля — где

⚠️ **SMTP в su10 нет** (`verifyEmail=false`, `resetPasswordAllowed=false`) — email-подтверждение и
самостоятельный сброс пароля по email недоступны.

- **Пользователь сам**: Account Console `https://auth.su10.ru/realms/su10/account` →
  Account security → Signing in → Update password (без email-reset).
- **Администратор**: Admin Console `https://auth-admin.su10.ru` → realm su10 → Users → пользователь →
  **Credentials → Reset password** (тумблер **Temporary** заставит сменить при следующем входе).
- **Пользователи с null-хэшем** (импортированы без credentials): вход возможен только после **выдачи
  пароля админом** (Admin-процедура выше).

## 8. Выкат и откат

1. Деплой кода BillHub с `AUTH_MODE=standalone` (keycloak-код дремлет); drift-fix активен и в standalone.
2. Клиент `billhub` + группы `billhub-*` (готово) + bcrypt-провайдер + login-тема `billhub`; **накат
   mapper+user-profile на su10** (config-cli + `apply-userprofile.sh`); проверка на тестовом realm.
3. Массовый импорт в su10 + группы + линки (§6, после Ф3).
4. **Canary**: `AUTH_MODE=keycloak` на одном инстансе (после снятия startup-инварианта, Ф4) — вход
   сотрудника и подрядчика, гейт по группе, `/me`, refresh, logout, роли из БД, документы/комментарии на
   месте, SSO с EstiMat.
5. Флип `AUTH_MODE=keycloak` в проде (`up -d`).
6. **Откат**: `AUTH_MODE=standalone` + `up -d` (фронт авто-адаптируется через `/api/auth/config`; гейт
   снова = `users.is_active`, standalone-семантика). Дельта-пользователи (созданные/сменившие пароль
   после cutover) при откате — админ-сброс: новых перечислить `password_hash IS NULL AND is_active`
   (готовый `listNullPasswordUsers` в `server/src/cli/import-passwords.ts`); сброс — `POST
   /api/auth/password/reset/request` (standalone). `password_hash`/standalone-код/refresh-таблицы не
   удалять до конца окна отката.

## 9. Приёмка (E2E)

- Брендированная страница входа Keycloak (07/08, переключатель light/dark) на `auth.su10.ru`.
- mapper + user-profile накачены на su10: токен несёт claim `billhub_user_id`, атрибут сохраняется.
- Сотрудник и подрядчик входят старым паролем; после первого входа credential в Keycloak — argon2
  (сначала на тестовом realm).
- `request.user.id` = прежний `users.id`; история/документы/комментарии/`counterparty_id` на месте.
- **Гейт только по KC-группе**: `billhub-active` → доступ; только `billhub-pending` → «ожидает
  активации»; нет группы → нет доступа. Сам по себе `is_active` доступ не даёт.
- Активация из KC-консоли и из BillHub-админки дают доступ одинаково (на следующем токене).
- Регистрация подрядчика — **Вариант B** (`register-counterparty` → Admin API), не self-registration.
- Резолв по `billhub_user_id` (провайдер-agnostic); email-fallback только для verified email.
- refresh продлевает; logout гасит BillHub и Keycloak; токены недоступны из JS; SSO с EstiMat.
- Роли строго из БД; claim-роли игнорируются.
