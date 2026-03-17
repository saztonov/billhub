# Миграция BillHub: Supabase -> Yandex Managed PostgreSQL + Node.js

## 1. Контекст и мотивация

BillHub -- портал для поставщиков: прикрепление счетов, оформление распределительных писем (РП), цепочки согласований, отправка в заказ, OCR-распознавание счетов.

### Проблемы текущей архитектуры

**Безопасность:**
- S3 ключи доступа (VITE_S3_ACCESS_KEY, VITE_S3_SECRET_KEY) хранятся в браузере -- любой пользователь может их извлечь
- OpenRouter API ключ (VITE_OPENROUTER_API_KEY) доступен в браузере
- Supabase anon key даёт доступ ко всем таблицам без RLS
- Вся авторизация и проверка ролей выполняется только на клиенте (React RoleGuard) -- серверной защиты нет

**Вендорная привязка:**
- 18 из 25 Zustand stores напрямую обращаются к Supabase Client
- Авторизация полностью завязана на Supabase Auth
- Нет возможности добавить серверную бизнес-логику без Edge Functions

**Архитектурные ограничения:**
- Отсутствие серверного слоя -- вся бизнес-логика на клиенте
- Невозможность реализовать серверные webhooks, cron jobs, фоновые задачи
- Presigned URLs для S3 генерируются в браузере (требуют секретные ключи)

---

## 2. Текущая архитектура

### Общая схема

```
React SPA (браузер)
  |
  +-- Supabase Client --> Supabase Auth (login, session, signUp)
  |                   --> Supabase PostgreSQL (29 таблиц, 50+ FK, 70+ индексов)
  |                   --> 2 RPC функции (generate_request_number, change_user_password)
  |
  +-- AWS SDK (@aws-sdk/client-s3) --> Cloud.ru S3 (хранение файлов)
  |   (ключи в браузере!)              Presigned URLs генерируются на клиенте
  |
  +-- fetch --> OpenRouter.ai API (OCR счетов через vision-модели)
      (ключ в браузере!)
```

### Технологический стек

- **Frontend:** React 19 + Vite + TypeScript + Ant Design 6 + Zustand
- **Backend:** Supabase (Auth, Database) -- нет собственного серверного кода
- **Storage:** Cloud.ru S3 (S3-совместимый API) / Cloudflare R2 (альтернатива)
- **OCR:** OpenRouter.ai API (выбор vision-модели в настройках)

### Масштаб проекта

| Категория | Количество |
|---|---|
| TypeScript/TSX файлов | 88 |
| Страниц (pages) | 16 |
| Компонентов | 29 |
| Zustand stores | 25 (из них 18 зависят от Supabase) |
| Сервисов | 5 |
| Хуков | 6 |
| Утилит | 7 |
| Таблиц БД | 29 |
| Foreign keys | 50+ |
| Индексов | 70+ |
| RPC функций | 2 |

### Supabase Auth -- текущее использование

| Метод | Где используется | Назначение |
|---|---|---|
| auth.signInWithPassword() | authStore.ts | Логин по email/password |
| auth.getSession() | authStore.ts | Проверка текущей сессии при загрузке app |
| auth.signOut() | authStore.ts | Выход из системы |
| auth.updateUser() | authStore.ts | Смена собственного пароля |
| auth.signUp() | userStore.ts (через supabaseNoSession) | Создание пользователей админом |

Роли: admin, user, counterparty_user. Хранятся в таблице users (не в Supabase Auth metadata).
Проверка на клиенте: RoleGuard.tsx + фильтрация меню в MainLayout.tsx.

### Все таблицы БД

**Справочники:**
1. users -- пользователи (id, email, role, counterparty_id, department_id, all_sites, full_name, is_active)
2. counterparties -- контрагенты (id, name, inn, address, alternative_names[JSONB], registration_token)
3. construction_sites -- объекты строительства (id, name, is_active)
4. suppliers -- поставщики (id, name, inn, alternative_names[JSONB])
5. document_types -- типы документов (id, name)
6. employees -- сотрудники (id, full_name, position, department, email, phone, role, is_active)
7. ocr_models -- OCR модели (id, name, model_id, is_active)

**Заявки:**
8. payment_requests -- заявки на оплату (37 полей, основная сущность)
9. payment_request_files -- файлы заявок
10. payment_request_comments -- комментарии
11. payment_request_assignments -- назначения ответственных
12. payment_request_logs -- лог действий
13. payment_request_field_options -- настраиваемые опции полей
14. comment_read_status -- статус прочитанности комментариев

**Согласования:**
15. approval_decisions -- решения по согласованиям (approve/reject/revision)
16. approval_decision_files -- файлы к решениям

**Оплаты:**
17. payment_payments -- платежи
18. payment_payment_files -- файлы платежей

**Документооборот:**
19. invoices -- счета
20. specifications -- спецификации (строки счёта)
21. distribution_letters -- распределительные письма
22. documents -- прикреплённые документы

**Маппинги (many-to-many):**
23. site_required_documents_mapping -- обязательные документы объектов
24. user_construction_sites_mapping -- доступ пользователей к объектам

**Служебные:**
25. notifications -- уведомления
26. statuses -- статусы (entity_type, code, name, color, visible_roles)
27. settings -- настройки (key-value, JSONB)
28. error_logs -- логи ошибок
29. request_number_sequence -- последовательность номеров заявок

**Enum типы:**
- department_enum: omts, shtab, smetny

**SQL функции:**
- generate_request_number() -- генерация уникального номера заявки (использует request_number_sequence)
- change_user_password(target_user_id uuid, new_password text) -- смена пароля админом

### Stores и их зависимости от Supabase

| Store | Таблицы | Операции |
|---|---|---|
| authStore | users | auth.signIn, auth.signOut, auth.getSession, select users |
| userStore | users, user_construction_sites_mapping | select, insert, update, delete, auth.signUp, rpc(change_user_password) |
| counterpartyStore | counterparties | CRUD + batch import |
| constructionSiteStore | construction_sites | CRUD |
| supplierStore | suppliers | CRUD + batch import |
| documentTypeStore | document_types | CRUD |
| statusStore | statuses | CRUD |
| paymentRequestStore | payment_requests, statuses, approval_decisions | select(JOIN), insert, update, delete, rpc(generate_request_number) |
| approvalStore | approval_decisions, payment_requests, approval_decision_files, notifications, payment_request_logs | select, insert, update (workflow согласований) |
| commentStore | payment_request_comments, comment_read_status | select(JOIN), insert, update, delete, upsert |
| notificationStore | notifications, construction_sites, payment_requests | select(JOIN), update |
| paymentPaymentStore | payment_payments, payment_payment_files | select, insert, update |
| assignmentStore | payment_request_assignments, users | select(JOIN), insert, update |
| settingsStore | ocr_models | CRUD |
| omtsRpStore | settings, construction_sites, users | select, update |
| paymentRequestSettingsStore | payment_request_field_options | CRUD |
| errorLogStore | error_logs, users | select(JOIN), delete |
| uploadQueueStore | payment_request_files, approval_decision_files | insert (после загрузки в S3) |

### Независимые от Supabase компоненты

- **s3.ts** -- Cloud.ru S3 / Cloudflare R2 через @aws-sdk/client-s3 (полностью автономен)
- **openrouter.ts** -- OCR через прямые HTTP-запросы к OpenRouter.ai
- **headerStore** -- чисто клиентское состояние

### Переменные окружения (текущие)

**Supabase:**
- VITE_SUPABASE_URL
- VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY
- VITE_SUPABASE_TENANT_ID

**S3:**
- VITE_STORAGE_PROVIDER (cloudru | cloudflare)
- VITE_S3_ENDPOINT, VITE_S3_REGION, VITE_S3_ACCESS_KEY, VITE_S3_SECRET_KEY, VITE_S3_BUCKET
- VITE_R2_ENDPOINT, VITE_R2_ACCESS_KEY, VITE_R2_SECRET_KEY, VITE_R2_BUCKET (альтернатива)

**OCR:**
- VITE_OPENROUTER_API_KEY

**Прочие:**
- VITE_MAX_FILE_SIZE_MB (default 100)
- VITE_APP_ENV (test | production)

---

## 3. Целевая архитектура

### Общая схема

```
React SPA (браузер)               Node.js API (Fastify)          Внешние сервисы
+---------------------+           +------------------------+     +-------------------+
|                     |  REST     |                        |     |                   |
| React 19 + Vite     | -------> | Fastify + TypeScript   |---->| Yandex Managed    |
| Ant Design 6        |  JWT     |                        |     | PostgreSQL 16     |
| Zustand 25 stores   | <------- | Drizzle ORM            |     |                   |
|                     |           |                        |     +-------------------+
| Единственная env:   |           | Middleware:             |
| VITE_API_URL        |           | - JWT auth              |     +-------------------+
|                     |           | - Role guard            |---->| Cloud.ru S3       |
+---------------------+           | - Rate limiting         |     | (presigned URLs)  |
                                  | - Error handler         |     +-------------------+
                                  | - CORS                  |
                                  |                        |     +-------------------+
                                  | Модули:                 |---->| OpenRouter.ai     |
                                  | - auth, users           |     | (OCR proxy)       |
                                  | - payment-requests      |     +-------------------+
                                  | - approvals             |
                                  | - comments              |
                                  | - notifications         |
                                  | - files (S3 proxy)      |
                                  | - ocr (OpenRouter proxy)|
                                  | - справочники (6 CRUD)  |
                                  | - payments              |
                                  | - assignments           |
                                  | - settings              |
                                  | - error-logs            |
                                  +------------------------+
```

### Технологический стек (целевой)

**Frontend (без изменений):**
- React 19 + Vite + TypeScript + Ant Design 6 + Zustand

**Backend (новый):**
- Node.js + TypeScript
- Fastify (HTTP фреймворк)
- Drizzle ORM (работа с PostgreSQL)
- bcryptjs (хеширование паролей)
- @fastify/jwt (JWT токены)
- @fastify/cors, @fastify/rate-limit, @fastify/helmet, @fastify/cookie
- @aws-sdk/client-s3, @aws-sdk/s3-request-presigner (S3 операции)

**База данных:**
- Yandex Managed PostgreSQL 16

**Хранилище файлов:**
- Cloud.ru S3 (без изменений, но ключи переезжают на сервер)

**OCR:**
- OpenRouter.ai API (без изменений, но ключ переезжает на сервер)

### Выбор Fastify

| Критерий | Fastify | Express | NestJS |
|---|---|---|---|
| Производительность | Высокая (в 2-3 раза быстрее Express) | Средняя | Средняя (обёртка над Express/Fastify) |
| TypeScript | Из коробки | Требует настройки | Из коробки |
| Валидация | Встроенная (JSON Schema) | Нужен middleware (express-validator) | Встроенная (class-validator) |
| JWT/CORS/Rate-limit | Официальные плагины | Сторонние middleware | Модули |
| Сложность | Низкая | Низкая | Высокая (DI, декораторы, модули) |
| Размер бойлерплейта | Минимальный | Минимальный | Значительный |

Fastify оптимален для CRUD-тяжёлого приложения с 70-80 endpoints: быстрый, с встроенной валидацией, без лишней сложности NestJS.

### Выбор Drizzle ORM

| Критерий | Drizzle | Prisma | Knex | pg (raw) |
|---|---|---|---|---|
| Типизация | Полная из схемы | Полная (генерация) | Частичная | Нет |
| Синтаксис | SQL-подобный | Свой DSL | SQL-подобный | Чистый SQL |
| Миграции | Встроенные | Встроенные | Встроенные | Вручную |
| Кодогенерация | Нет | Да (prisma generate) | Нет | Нет |
| Relational queries | Да | Да | Нет | Вручную |
| Вес | Легкий | Тяжёлый | Средний | Минимальный |
| Сходство с Supabase | Высокое (from().select()) | Низкое | Среднее | Низкое |

Drizzle -- оптимальный выбор: SQL-подобный синтаксис (облегчит перенос с Supabase query builder), полная типизация, нет кодогенерации, встроенные миграции.

### Структура backend (monorepo)

```
billhub/                        <-- текущий репозиторий (фронтенд)
  src/                          <-- React фронтенд
  server/                       <-- НОВЫЙ: Node.js backend
    src/
      config/
        env.ts                  -- загрузка и валидация переменных окружения
        database.ts             -- connection pool (Drizzle + pg)
      db/
        schema/                 -- Drizzle-описание 29 таблиц
          users.ts
          counterparties.ts
          paymentRequests.ts
          approvalDecisions.ts
          ... (по файлу на таблицу или группу)
          index.ts              -- реэкспорт всех схем
        migrations/             -- SQL-миграции (drizzle-kit)
        seed/                   -- начальные данные (если нужно)
      modules/
        auth/
          auth.routes.ts        -- POST /auth/login, /auth/logout, /auth/session, /auth/refresh
          auth.service.ts       -- бизнес-логика авторизации
          auth.schemas.ts       -- JSON Schema для валидации входных данных
        users/
          users.routes.ts       -- GET/POST/PUT/DELETE /users, batch import, site mapping
          users.service.ts
          users.schemas.ts
        payment-requests/
          payment-requests.routes.ts
          payment-requests.service.ts
          payment-requests.schemas.ts
        approvals/
          approvals.routes.ts
          approvals.service.ts
          approvals.schemas.ts
        comments/
          comments.routes.ts
          comments.service.ts
        notifications/
          notifications.routes.ts
          notifications.service.ts  -- включает логику определения получателей (из notificationService.ts)
        counterparties/
          counterparties.routes.ts
          counterparties.service.ts
        construction-sites/
          construction-sites.routes.ts
          construction-sites.service.ts
        suppliers/
          suppliers.routes.ts
          suppliers.service.ts
        document-types/
          document-types.routes.ts
          document-types.service.ts
        statuses/
          statuses.routes.ts
          statuses.service.ts
        payments/
          payments.routes.ts
          payments.service.ts
        assignments/
          assignments.routes.ts
          assignments.service.ts
        files/
          files.routes.ts       -- presigned URL генерация, upload metadata
          files.service.ts      -- S3 операции (@aws-sdk)
        ocr/
          ocr.routes.ts         -- POST /ocr/recognize
          ocr.service.ts        -- OpenRouter API proxy
        settings/
          settings.routes.ts    -- OCR models, OMTS RP config
          settings.service.ts
        error-logs/
          error-logs.routes.ts
          error-logs.service.ts
      middleware/
        auth.ts                 -- JWT verification (access token из заголовка)
        role-guard.ts           -- проверка роли (admin, user, counterparty_user)
        error-handler.ts        -- централизованная обработка ошибок
        rate-limiter.ts         -- конфигурация rate limiting
      types/
        index.ts                -- общие TypeScript типы
      utils/
        date.ts                 -- утилиты для дат
        password.ts             -- bcrypt helpers
      app.ts                    -- создание и конфигурация Fastify instance
      server.ts                 -- entry point (запуск сервера)
    package.json
    tsconfig.json
    drizzle.config.ts           -- конфигурация Drizzle Kit
    .env.example
```

---

## 4. Авторизация (новая архитектура)

### JWT-схема

```
Логин:
  POST /auth/login { email, password }
    1. Найти пользователя в БД по email
    2. Проверить is_active
    3. Сравнить password с password_hash (bcrypt.compare)
    4. Сгенерировать access token (JWT, 15 мин)
    5. Сгенерировать refresh token (JWT, 7 дней), сохранить в БД
    6. Вернуть: { accessToken, user } + Set-Cookie: refreshToken (httpOnly)

Проверка сессии:
  GET /auth/session
    Headers: Authorization: Bearer <accessToken>
    1. Middleware расшифровывает JWT
    2. Загружает актуальные данные пользователя из БД
    3. Проверяет is_active
    4. Возвращает: { user }

Обновление токена:
  POST /auth/refresh
    Cookie: refreshToken
    1. Проверить refresh token в БД (существует, не истёк)
    2. Сгенерировать новую пару access + refresh
    3. Удалить старый refresh, сохранить новый
    4. Вернуть: { accessToken } + новый Set-Cookie

Выход:
  POST /auth/logout
    1. Удалить refresh token из БД
    2. Очистить cookie
```

### Payload JWT (access token)

```json
{
  "userId": "uuid",
  "email": "user@example.com",
  "role": "admin | user | counterparty_user",
  "counterpartyId": "uuid | null",
  "department": "omts | shtab | smetny | null",
  "allSites": true
}
```

### Изменения в схеме БД для авторизации

**Таблица users -- добавить поле:**
- password_hash VARCHAR(255) NOT NULL

**Новая таблица refresh_tokens:**
```
refresh_tokens:
  id UUID PRIMARY KEY DEFAULT gen_random_uuid()
  token TEXT NOT NULL UNIQUE
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE
  expires_at TIMESTAMPTZ NOT NULL
  created_at TIMESTAMPTZ DEFAULT now()

INDEX: idx_refresh_tokens_token ON refresh_tokens(token)
INDEX: idx_refresh_tokens_user_id ON refresh_tokens(user_id)
INDEX: idx_refresh_tokens_expires_at ON refresh_tokens(expires_at)
```

### Миграция паролей из Supabase

Supabase хранит пароли в bcrypt -- формат полностью совместим с Node.js bcryptjs.

**Шаги:**
1. Supabase Dashboard --> SQL Editor, выполнить:
   ```sql
   SELECT id, encrypted_password FROM auth.users;
   ```
2. Скачать результат (кнопка "Download CSV" в SQL Editor)
3. Написать миграционный скрипт, который:
   - Читает CSV
   - Для каждого id находит соответствующую запись в public.users
   - Записывает encrypted_password в поле password_hash
4. Запустить скрипт на Yandex PostgreSQL

Пользователям не нужно будет менять пароли -- bcrypt-хеши переносятся как есть.

### Замена RPC-функций Supabase

**generate_request_number():**
- Перенести ту же SQL-функцию в Yandex PostgreSQL
- Использовать таблицу request_number_sequence (year, last_number)
- Вызывать через Drizzle: `db.execute(sql'SELECT generate_request_number()')`

**change_user_password():**
- Больше не нужна как SQL-функция
- Станет endpoint PUT /users/:id/password
- Логика: bcrypt.hash(newPassword, 10) --> UPDATE users SET password_hash = ...

---

## 5. Миграция базы данных

### Экспорт из Supabase

**Шаг 1: Получить connection string**
- Supabase Dashboard --> Settings --> Database --> Connection string
- Формат: `postgresql://postgres:[PASSWORD]@[HOST]:5432/postgres`

**Шаг 2: pg_dump только public schema**
```bash
pg_dump \
  --host=<supabase-host> \
  --port=5432 \
  --username=postgres \
  --dbname=postgres \
  --schema=public \
  --no-owner \
  --no-acl \
  --format=custom \
  --file=billhub_public.dump
```

Важно: не экспортировать схемы auth, storage, realtime, extensions -- они специфичны для Supabase.

**Шаг 3: Экспорт хешей паролей (отдельно)**
- SQL Editor --> `SELECT id, encrypted_password FROM auth.users`
- Скачать CSV

### Настройка Yandex Managed PostgreSQL

**Создание кластера:**
- Версия: PostgreSQL 16
- Конфигурация хоста: начать с s2.micro (2 vCPU, 8 GB RAM), масштабировать по нагрузке
- Хранилище: SSD, 20 GB (с возможностью расширения)
- Зона доступности: одна (для начала), две -- для HA в production
- Публичный доступ: включить (backend на отдельном VPS)
- SSL: обязателен

**Networking:**
- Security group: разрешить порт 6432 только с IP адреса VPS
- Connection pooling: использовать встроенный Odyssey (порт 6432)

**Бэкапы:**
- Автоматические: ежедневно, хранение 7 дней
- PITR (Point-in-Time Recovery): включить

**Расширения PostgreSQL:**
- pgcrypto (для gen_random_uuid() если не доступна по умолчанию)
- pg_stat_statements (мониторинг запросов)

### Импорт в Yandex PostgreSQL

**Шаг 1: Создать базу данных**
```bash
psql --host=<yandex-host> --port=6432 --username=<user> --dbname=postgres \
  -c "CREATE DATABASE billhub;"
```

**Шаг 2: Восстановить дамп**
```bash
pg_restore \
  --host=<yandex-host> \
  --port=6432 \
  --username=<user> \
  --dbname=billhub \
  --no-owner \
  --no-acl \
  billhub_public.dump
```

**Шаг 3: Применить миграции новой архитектуры**
- ALTER TABLE users ADD COLUMN password_hash VARCHAR(255)
- CREATE TABLE refresh_tokens (...)
- Создать индексы для refresh_tokens

**Шаг 4: Заполнить password_hash**
- Запустить миграционный скрипт с CSV из Supabase auth.users

**Шаг 5: Верификация**
- Проверить: все 29 таблиц на месте
- Проверить: 50+ FK constraints
- Проверить: 70+ индексов
- Проверить: enum department_enum
- Проверить: функция generate_request_number() работает
- Проверить: данные целостны (COUNT по ключевым таблицам)

---

## 6. Безопасность

### Перенос секретов на сервер

| Секрет | Было (в браузере) | Стало (на сервере) |
|---|---|---|
| S3 Access Key | VITE_S3_ACCESS_KEY | S3_ACCESS_KEY |
| S3 Secret Key | VITE_S3_SECRET_KEY | S3_SECRET_KEY |
| OpenRouter API Key | VITE_OPENROUTER_API_KEY | OPENROUTER_API_KEY |
| Supabase Key | VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY | Удалён |
| Database URL | -- | DATABASE_URL (только сервер) |
| JWT Secret | -- | JWT_SECRET (только сервер) |
| JWT Refresh Secret | -- | JWT_REFRESH_SECRET (только сервер) |

**Фронтенд после миграции:** единственная переменная `VITE_API_URL`

### Серверная авторизация

**JWT Middleware (auth.ts):**
- Каждый запрос (кроме /auth/login, /auth/refresh) проверяет access token
- При невалидном/отсутствующем токене: 401 Unauthorized

**Role Guard Middleware (role-guard.ts):**
- Проверяет роль из JWT payload
- Разграничение доступа на уровне endpoint
- Пример: admin endpoints (управление пользователями, настройки) недоступны для counterparty_user

**Фильтрация данных:**
- counterparty_user видит только заявки своего контрагента -- фильтрация в SQL WHERE, не на клиенте
- user видит заявки по своим объектам строительства -- серверная фильтрация по user_construction_sites_mapping

### CORS

```
Allowed origins: [frontendDomain, 'http://localhost:5173' (dev)]
Credentials: true (для httpOnly cookies с refresh token)
Methods: GET, POST, PUT, DELETE, PATCH
```

### Rate Limiting

| Категория | Лимит | Назначение |
|---|---|---|
| Глобальный | 100 req/min на IP | Общая защита |
| Auth endpoints | 5 req/min на IP | Защита от brute force |
| Upload endpoints | 20 req/min на пользователя | Защита от спама |
| OCR endpoint | 10 req/min на пользователя | Защита от злоупотребления API |

### Input Validation

- JSON Schema валидация на каждом endpoint (встроена в Fastify)
- Проверка UUID для всех :id параметров
- Санитизация текстовых полей
- Ограничение размера request body (10 MB обычные, configurable для файлов)
- Helmet: стандартные security headers

---

## 7. API Endpoints (маппинг stores --> REST)

### Auth (authStore)
```
POST   /auth/login              { email, password } --> { accessToken, user }
POST   /auth/logout             --> 204
GET    /auth/session            --> { user }
POST   /auth/refresh            (cookie) --> { accessToken }
PUT    /auth/password           { currentPassword, newPassword } --> 204
```

### Users (userStore)
```
GET    /users                   ?role=&search= --> { users[] }
GET    /users/:id               --> { user, sites[] }
POST   /users                   { email, password, fullName, role, ... } --> { user }
PUT    /users/:id               { fullName, role, department, ... } --> { user }
PUT    /users/:id/password      { newPassword } --> 204  (admin only)
PUT    /users/:id/activate      --> 204
PUT    /users/:id/deactivate    --> 204
PUT    /users/:id/sites         { siteIds[] } --> 204
POST   /users/batch             { users[] } --> { created, errors }
```

### Counterparties (counterpartyStore)
```
GET    /counterparties          ?search= --> { counterparties[] }
GET    /counterparties/:id      --> { counterparty }
POST   /counterparties          { name, inn, address, alternativeNames } --> { counterparty }
PUT    /counterparties/:id      --> { counterparty }
DELETE /counterparties/:id      --> 204
POST   /counterparties/batch    { counterparties[] } --> { created, errors }
```

### Construction Sites (constructionSiteStore)
```
GET    /construction-sites      --> { sites[] }
POST   /construction-sites      { name } --> { site }
PUT    /construction-sites/:id  --> { site }
DELETE /construction-sites/:id  --> 204
```

### Suppliers (supplierStore)
```
GET    /suppliers               ?search= --> { suppliers[] }
POST   /suppliers               { name, inn, alternativeNames } --> { supplier }
PUT    /suppliers/:id           --> { supplier }
DELETE /suppliers/:id           --> 204
POST   /suppliers/batch         --> { created, errors }
```

### Document Types (documentTypeStore)
```
GET    /document-types          --> { documentTypes[] }
POST   /document-types          { name } --> { documentType }
PUT    /document-types/:id      --> { documentType }
DELETE /document-types/:id      --> 204
```

### Statuses (statusStore)
```
GET    /statuses                ?entityType= --> { statuses[] }
POST   /statuses                --> { status }
PUT    /statuses/:id            --> { status }
DELETE /statuses/:id            --> 204
```

### Payment Requests (paymentRequestStore)
```
GET    /payment-requests        ?status=&counterpartyId=&siteId=&dateFrom=&dateTo=&tab= --> { requests[], total }
GET    /payment-requests/:id    --> { request (с joins: counterparty, site, supplier, status, files, assignments) }
POST   /payment-requests        { counterpartyId, siteId, ... } --> { request }
PUT    /payment-requests/:id    --> { request }
DELETE /payment-requests/:id    --> 204 (soft delete)
POST   /payment-requests/:id/withdraw    { comment } --> 204
POST   /payment-requests/:id/resubmit   { comment } --> 204
GET    /payment-requests/:id/files       --> { files[] }
PUT    /payment-requests/files/:fileId/reject  --> 204
```

### Approvals (approvalStore)
```
GET    /approvals/decisions/:requestId    --> { decisions[], files[] }
POST   /approvals/:requestId/approve      { comment } --> 204
POST   /approvals/:requestId/reject       { comment, files[] } --> 204
POST   /approvals/:requestId/revision     { comment } --> 204
GET    /approvals/logs/:requestId         --> { logs[] }
```

### Comments (commentStore)
```
GET    /comments/:requestId     --> { comments[] }
POST   /comments                { paymentRequestId, text, recipient } --> { comment }
PUT    /comments/:id            { text } --> { comment }
DELETE /comments/:id            --> 204
GET    /comments/unread-counts  --> { counts: { [requestId]: number } }
POST   /comments/:requestId/mark-read  --> 204
```

### Notifications (notificationStore)
```
GET    /notifications           ?isRead=&limit=&offset= --> { notifications[], total }
GET    /notifications/unread-count  --> { count }
PUT    /notifications/:id/read  --> 204
PUT    /notifications/read-all  --> 204
```

### Payments (paymentPaymentStore)
```
GET    /payments/:requestId     --> { payments[] }
POST   /payments                { paymentRequestId, paymentNumber, paymentDate, amount } --> { payment }
PUT    /payments/:id            --> { payment }
GET    /payments/:id/files      --> { files[] }
```

### Assignments (assignmentStore)
```
GET    /assignments/:requestId          --> { current, history[] }
POST   /assignments/:requestId/assign   { assignedUserId } --> 204
```

### Files (uploadQueueStore + s3.ts)
```
POST   /files/request-upload-url    { paymentRequestId, fileName, mimeType, documentTypeId } --> { uploadUrl, fileKey }
POST   /files/decision-upload-url   { approvalDecisionId, fileName, mimeType } --> { uploadUrl, fileKey }
POST   /files/payment-upload-url    { paymentPaymentId, fileName, mimeType } --> { uploadUrl, fileKey }
POST   /files/confirm-upload        { fileKey, paymentRequestId, ... } --> 204 (записать метаданные в БД)
GET    /files/download-url/:fileKey --> { downloadUrl }
DELETE /files/:fileKey              --> 204
```

### OCR (openrouter.ts)
```
POST   /ocr/recognize           { imageBase64, modelId } --> { result }
GET    /ocr/models               --> { models[] }
```

### Settings (settingsStore + omtsRpStore + paymentRequestSettingsStore)
```
GET    /settings/ocr-models      --> { models[] }
POST   /settings/ocr-models      { modelId, modelName } --> { model }
DELETE /settings/ocr-models/:id  --> 204
PUT    /settings/ocr-models/:id/activate  --> 204

GET    /settings/omts-rp         --> { sites[], config }
PUT    /settings/omts-rp         --> 204

GET    /settings/field-options   ?fieldCode= --> { options[] }
POST   /settings/field-options   --> { option }
PUT    /settings/field-options/:id  --> { option }
DELETE /settings/field-options/:id  --> 204
```

### Error Logs (errorLogStore)
```
GET    /error-logs               ?page=&pageSize=&type=&dateFrom=&dateTo= --> { logs[], total }
POST   /error-logs               { errorType, errorMessage, ... } --> 201
DELETE /error-logs/old           ?olderThan= --> { deleted }
```

---

## 8. Изменения на фронтенде

### Новый API-клиент (src/services/api.ts)

Заменяет: supabase.ts, supabaseAdmin.ts, s3.ts, openrouter.ts

Функциональность:
- Базовый URL из VITE_API_URL
- Автоматическое прикрепление access token (Authorization: Bearer)
- Interceptor при 401: попытка обновить access token через /auth/refresh, при неудаче -- редирект на login
- Типизированные методы: api.get<T>(), api.post<T>(), api.put<T>(), api.delete()
- Централизованная обработка ошибок

Рекомендация по HTTP-клиенту: `ky` (2.4 KB, нативный fetch wrapper, hooks для JWT) или просто fetch + обёртка.

### Auth flow (новый)

```
1. Приложение загружается --> GET /auth/session
2. Если 401 --> POST /auth/refresh (cookie)
3. Если refresh OK --> новый access token, повторить GET /auth/session
4. Если refresh FAIL --> редирект на /login

Login:
1. POST /auth/login { email, password }
2. Получить { accessToken, user }
3. Сохранить accessToken в памяти (не localStorage -- безопаснее)
4. refresh token автоматически в httpOnly cookie

Logout:
1. POST /auth/logout
2. Очистить accessToken в памяти
3. Редирект на /login
```

### Переписывание stores

Шаблон изменений для каждого store:
- Убрать `import { supabase } from '@/services/supabase'`
- Добавить `import { api } from '@/services/api'`
- Заменить `supabase.from('table').select(...)` на `api.get<Type[]>('/endpoint')`
- Заменить `supabase.from('table').insert(...)` на `api.post<Type>('/endpoint', data)`
- Убрать ручной маппинг snake_case --> camelCase (backend будет возвращать camelCase)
- Убрать ручную типизацию `as Record<string, unknown>` (API возвращает типизированные данные)

### Удаляемые файлы фронтенда

- src/services/supabase.ts -- заменяется api.ts
- src/services/supabaseAdmin.ts -- не нужен (backend сам создаёт пользователей)
- src/services/s3.ts -- логика переезжает на backend (модуль files)
- src/services/openrouter.ts -- логика переезжает на backend (модуль ocr)
- src/utils/notificationService.ts -- логика определения получателей переезжает на backend

### Удаляемые npm-зависимости (frontend)

- @supabase/supabase-js
- @aws-sdk/client-s3
- @aws-sdk/s3-request-presigner

### Переменные окружения (frontend, после миграции)

Было 12+ переменных --> стало 1:
- `VITE_API_URL` -- URL Node.js backend API

---

## 9. Поэтапный план реализации

### Фаза 0: Подготовка инфраструктуры

**Задачи:**
1. Создать кластер Yandex Managed PostgreSQL 16
2. Настроить security group (порт 6432 только для IP VPS)
3. Экспортировать данные из Supabase (pg_dump public schema)
4. Экспортировать password hashes из auth.users (SQL Editor)
5. Импортировать данные в Yandex PostgreSQL (pg_restore)
6. Применить миграцию: password_hash + refresh_tokens
7. Заполнить password_hash данными из Supabase
8. Верифицировать целостность данных

### Фаза 1: Backend -- каркас + авторизация

**Задачи:**
1. Инициализировать server/ (package.json, tsconfig.json, Fastify + TypeScript)
2. Настроить Drizzle ORM: schema для 29 таблиц, подключение к Yandex PG
3. Реализовать auth модуль (login, logout, session, refresh, change password)
4. JWT middleware + role guard middleware
5. CORS, rate limiting, error handler, helmet
6. Проверить: логин/выход всеми тремя ролями

### Фаза 2: Backend -- CRUD-модули справочников

Все модули независимы друг от друга, можно реализовывать параллельно:

1. counterparties (CRUD + batch import)
2. construction-sites (CRUD)
3. suppliers (CRUD + batch import)
4. document-types (CRUD)
5. statuses (CRUD с фильтром по entity_type)
6. users (CRUD + batch import + site mapping + activate/deactivate)
7. settings (OCR models, OMTS RP config)
8. payment-request-settings (field options)
9. error-logs (list + delete old)

### Фаза 3: Backend -- бизнес-логика

1. payment-requests (самый сложный: create с generate_request_number, update, withdraw, resubmit, soft delete, списки с фильтрами и пагинацией, JOINs)
2. approvals (approve/reject/revision workflow с переходами между этапами)
3. comments (CRUD + unread counts + mark as read)
4. notifications (CRUD + сервис рассылки -- перенос логики из notificationService.ts)
5. assignments (текущий + история + назначение)
6. payments (CRUD + файлы + пересчёт статуса оплаты)

### Фаза 4: Backend -- файлы и OCR

1. files модуль (presigned URL генерация на сервере для upload/download/delete)
2. Маршрутизация файлов по типам (request files, decision files, payment files)
3. OCR proxy (OpenRouter -- POST /ocr/recognize)
4. Проверить: загрузка/скачивание/удаление файлов через новое API

### Фаза 5: Frontend -- переключение на новое API

1. Создать src/services/api.ts (HTTP-клиент с JWT)
2. Переписать authStore (JWT flow вместо Supabase Auth)
3. Переписать справочниковые stores (простые CRUD -- параллелятся)
4. Переписать paymentRequestStore, approvalStore (самые сложные)
5. Переписать остальные stores (comments, notifications, assignments, payments, settings, error-logs)
6. Переписать uploadQueueStore (API вместо прямых S3-вызовов)
7. Удалить старые сервисы (supabase.ts, supabaseAdmin.ts, s3.ts, openrouter.ts)
8. Удалить Supabase и S3 зависимости из package.json

### Фаза 6: Тестирование и переключение

1. Регрессионное тестирование всех пользовательских сценариев
2. Проверить все три роли (admin, user, counterparty_user)
3. Финальная синхронизация данных (дельта с момента первой миграции)
4. Переключить фронтенд на новый API (VITE_API_URL)
5. Мониторинг первых дней работы

**Downtime при переключении: 5-15 минут** (переключение VITE_API_URL + финальная синхронизация дельты)

---

## 10. Переменные окружения (итоговые)

### Backend (server/.env)

```
# Database
DATABASE_URL=postgresql://user:password@host:6432/billhub?sslmode=require

# JWT
JWT_SECRET=<random-256-bit>
JWT_REFRESH_SECRET=<random-256-bit>
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d

# S3 (Cloud.ru)
S3_ENDPOINT=https://...
S3_REGION=ru-central-1
S3_ACCESS_KEY=<key>
S3_SECRET_KEY=<secret>
S3_BUCKET=billhub

# OpenRouter
OPENROUTER_API_KEY=<key>

# Server
PORT=3000
CORS_ORIGIN=https://billhub.example.com
NODE_ENV=production
```

### Frontend (.env)

```
VITE_API_URL=https://api.billhub.example.com
```

---

## 11. Проверка работоспособности

### Авторизация
- Логин admin, user, counterparty_user -- успешный вход
- Неверный пароль -- ошибка 401
- Деактивированный пользователь -- ошибка при логине
- Token refresh -- после истечения access token (15 мин) запрос автоматически обновляет токен
- Смена пароля -- работает для собственного и для чужого (admin)
- Выход -- refresh token удалён, повторный запрос возвращает 401

### Заявки (полный цикл)
1. Создание заявки (counterparty_user) -- номер генерируется автоматически
2. Загрузка файлов -- presigned URL от backend, upload в S3
3. Отправка на согласование
4. Согласование Штаб (user с ролью shtab)
5. Согласование ОМТС (user с ролью omts)
6. Согласование Сметный (user с ролью smetny)
7. Одобрение / Отклонение
8. Повторная отправка при отклонении
9. Добавление оплат

### Файлы
- Загрузка файла заявки -- presigned URL работает
- Скачивание файла -- presigned URL работает
- Удаление файла -- файл удалён из S3 и метаданные из БД

### Роли и безопасность
- counterparty_user видит только заявки своего контрагента
- user не видит раздел администрирования
- Без JWT все endpoints возвращают 401
- В браузере DevTools нет секретных ключей (S3, OpenRouter, DB)
- Rate limiting работает (5 req/min на auth)

### OCR
- Загрузка изображения счёта --> распознавание через проксированный OpenRouter
- Результат корректно парсится

### Уведомления
- При согласовании/отклонении заявки -- уведомления доходят до нужных пользователей
- Счётчик непрочитанных обновляется
- Пометка прочитанным работает
