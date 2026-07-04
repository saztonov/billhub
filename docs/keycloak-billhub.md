# Подключение BillHub к Keycloak (realm su10) — пошаговая инструкция

Руководство по подключению портала **BillHub** как ещё одного клиента в **существующий**
корпоративный Keycloak контура su10 (realm `su10`, `auth.su10.ru`, KC 26.1). Аутентификация —
OIDC Authorization Code + PKCE, паттерн BFF (браузер токенов не видит, всё в httpOnly-cookie).
Образец инфраструктуры — `EstiMat/deploy/infra-keycloak/README.md` (клиент `estimat`).

Секреты (client secret, пароли БД) — только в `/etc/billhub/*.env` (права 640), в чат/логи не выводить.

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
- **Client-роли в токен НЕ добавлять** — роли/контрагент берутся из БД BillHub.

### Сервис-аккаунт (Admin REST)
- Service accounts roles: On. Назначить права **читать пользователей** и **управлять членством в
  группах** портала (`view-users`, `manage-users` из client `realm-management`, либо тонко —
  на группы billhub-*). Используется для линковки и активации (перевод групп).
- Если для Admin REST используется отдельный клиент — задать `KC_ADMIN_CLIENT_ID`/
  `KC_ADMIN_CLIENT_SECRET`; иначе берётся клиент `billhub`.

## 2. Группы портала (гейт доступа)

Groups → создать:
- **`billhub-pending`** — доступ заведён, не активен.
- **`billhub-active`** — доступ активен (гейт: бэкенд пускает только при членстве в ней).

Активировать доступ можно из двух мест: **админ-консоль Keycloak** (Users → пользователь → Groups →
добавить в `billhub-active`) и **админка BillHub** (Администрирование → Пользователи →
переключатель «Активен», двигает группу через Admin API).

## 3. Само-регистрация подрядчиков

Realm settings → Login → **User registration = On**. Ссылка «Регистрация» на странице входа
создаёт идентичность в Keycloak. Доступ к BillHub даёт вход по регистрационной ссылке контрагента
(`/register?token=…` в BillHub → `/api/auth/login?regToken=…`): BillHub на callback заводит
**неактивную** строку `users` + группу `billhub-pending`; активирует админ.

## 4. bcrypt-провайдер (для переноса паролей)

Keycloak «из коробки» проверяет только native-алгоритм (argon2 на KC26 non-FIPS). Для приёма
перенесённых bcrypt-хэшей:
1. Собрать/взять `PasswordHashProvider` bcrypt, совместимый с KC 26.1 (Quarkus); JAR →
   `/opt/keycloak/providers`; `kc.sh build`; перезапуск.
2. Realm password policy оставить дефолтной (argon2). Провайдер нужен только для проверки
   импортированных кредов; при первом входе Keycloak перехэширует пароль в argon2.
3. **Доказать формат на ТЕСТОВОМ realm** (не su10): импортировать одного пользователя с
   bcrypt-credential, войти старым паролем, убедиться что credential перехэшировался в argon2.
   Держать провайдер, пока все активные не перехэшируются; затем убрать.

## 5. Переменные окружения BillHub

`/etc/billhub/runtime.env` (значения — не в git):
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
Применение env — только пересозданием контейнеров (`up -d`, не `restart`).

## 6. Массовый перенос существующей базы аккаунтов (ops, SSH → VPS2)

Переносится **вся** `public.users` (сотрудники + текущие подрядчики) — идентичности и
**bcrypt-хэши паролей** (пароли не сбрасываются). Отдельный шаг, только после подтверждения и
после доказательства формата на тестовом realm.
1. **Preflight**: backup БД BillHub + realm export su10; отсев дублей `lower(email)`,
   невалидных `$2[aby]$12$`, null-хэшей; зафиксировать метку cutover.
2. **partialImport** батчами (`ifResourceExists:SKIP`, `id=users.id` сохраняется); null-хэш →
   без credentials.
3. **Группы и линки**: прочитать **фактический** KC-id по username/email (SKIP не гарантирует
   `sub=users.id`); активных добавить в `billhub-active`; записать `user_identity_links`
   (`provider=keycloak-local, subject=<реальный KC sub>, user_id=users.id, email_at_link`);
   падать на mismatch без явного одобрения.

## 7. Смена пароля — где

- **Пользователь сам**: Account Console `https://auth.su10.ru/realms/su10/account` →
  Account security → Signing in → Update password.
- **Администратор**: Admin Console `https://auth-admin.su10.ru` → realm su10 → Users →
  пользователь → **Credentials → Reset password** (тумблер **Temporary** заставит сменить при
  следующем входе).

## 8. Выкат и откат

1. Деплой кода с `AUTH_MODE=standalone` (keycloak-код дремлет); drift-fix активен и в standalone.
2. Клиент `billhub` + группы `billhub-*` + bcrypt-провайдер + login-тема `billhub`; проверка на
   тестовом realm.
3. Массовый импорт в su10 + группы + линки (§6).
4. **Canary**: `AUTH_MODE=keycloak` на одном инстансе — вход сотрудника и подрядчика, гейт по
   группе, `/me`, refresh, logout, роли из БД, документы/комментарии на месте, SSO с EstiMat.
5. Флип `AUTH_MODE=keycloak` в проде (`up -d`).
6. **Откат**: `AUTH_MODE=standalone` + `up -d` (фронт авто-адаптируется через `/api/auth/config`;
   гейт снова = `users.is_active`). Дельта-пользователи (созданные/сменившие пароль после cutover)
   при откате — админ-сброс: новых перечислить `password_hash IS NULL AND is_active`
   (готовый `listNullPasswordUsers` в `server/src/cli/import-passwords.ts`); сброс — `POST
   /api/auth/password/reset/request` (standalone). `password_hash`/standalone-код/refresh-таблицы
   не удалять до конца окна отката.

## 9. Приёмка (E2E)

- Брендированная страница входа Keycloak (07/08, переключатель light/dark) на `auth.su10.ru`.
- Сотрудник и подрядчик входят старым паролем; после первого входа credential в Keycloak —
  argon2 (сначала на тестовом realm).
- `request.user.id` = прежний `users.id`; история/документы/комментарии/`counterparty_id` на месте.
- Гейт по группе: `billhub-active` → доступ; только `billhub-pending` → «ожидает активации»; нет
  группы → нет доступа.
- Само-регистрация подрядчика по токену → неактивный пользователь → активация админом (BillHub или
  Keycloak) → доступ.
- refresh продлевает; logout гасит BillHub и Keycloak; токены недоступны из JS; SSO с EstiMat.
- Роли строго из БД; claim-роли игнорируются.
