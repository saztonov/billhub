# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Проект

BillHub — портал для поставщиков: прикрепление счетов, оформление распределительных писем (РП), цепочки согласований, отправка в заказ. OCR-распознавание счетов через OpenRouter.ai.

Архитектура — **клиент-серверная**: React-SPA (без секретов) общается с собственным Fastify-бэкендом по REST `/api`. Секреты (S3, OpenRouter, БД) — только на сервере. Данные — в Yandex Managed PostgreSQL, файлы — в Cloud.ru S3, очереди/OCR — Redis + BullMQ. Авторизация — собственная (standalone JWT), без Supabase Auth в активном пути.

**Стек:**

- Frontend: React 19 + Vite 7 + TypeScript 5.9 + Ant Design 6 + Zustand 5 + react-router-dom 7
- Backend: Fastify 5 + TypeScript (Node 20+), pino, zod, helmet
- База данных: Yandex Managed PostgreSQL + Drizzle ORM (SQL-first), драйвер postgres.js
- Авторизация: standalone JWT (bcrypt + access JWT HS256 через `jose` + opaque refresh с ротацией), CSRF double-submit
- Storage: Cloud.ru S3 (S3-совместимый, `@aws-sdk/client-s3`) — доступ только с сервера
- Очереди: Redis + BullMQ (обработка файлов, OCR)
- OCR: OpenRouter.ai (vision-модели) — вызывается на сервере
- Деплой: Docker (VPS2), общий ingress nginx + certbot

## Быстрый старт

**Frontend (корень репозитория):**

```bash
npm run dev        # Vite dev server (порт 5173); проксирует /api на localhost:3000
npm run build      # tsc -b && vite build
npm run lint       # eslint
npm run typecheck  # tsc -b --noEmit
npm run test       # vitest
```

**Backend (каталог `server/`):**

```bash
cd server
npm run dev         # Fastify API (tsx watch src/server.ts, порт 3000)
npm run dev:worker  # BullMQ worker (tsx watch src/worker.ts)
npm run build       # tsc
npm run test        # vitest run
npm run typecheck   # tsc --noEmit
npm run db:migrate  # накат новых миграций (tsx src/cli/migrate.ts)
```

## Архитектура

```
src/                # Frontend (React SPA)
├── pages/          # Страницы-роуты
├── components/     # UI-компоненты
├── hooks/          # Кастомные хуки (useAuthRefresh и т.д.)
├── services/       # API-клиент (api.ts — REST-обёртка), s3-proxy, errorLogger
├── store/          # Zustand stores (authStore и др.)
├── types/          # TypeScript типы/интерфейсы
├── utils/          # Утилиты (fileValidation и т.д.)
├── layout/         # Layout-компоненты (MainLayout, AuthLayout)
└── theme/          # Тема Ant Design

server/src/         # Backend (Fastify)
├── routes/         # HTTP-роуты (auth, files, ...)
├── plugins/        # Fastify-плагины (auth, csrf, db, ...)
├── middleware/     # authenticate, requireRole, rate-limit
├── services/       # Бизнес-логика: auth/, mail/, observability/, s3/ocr
├── repositories/   # Доступ к данным (Drizzle)
├── db/             # Drizzle-схема
├── queues/         # BullMQ-очереди и обработчики
├── cli/            # migrate, import-passwords, smoke и др.
├── config/, config.ts  # Конфиг из env
├── schemas/        # zod-схемы валидации
├── server.ts       # Точка входа API-процесса
└── worker.ts       # Точка входа worker-процесса (BullMQ)
```

**Path aliases:**

- Frontend `@/` -> `./src` (vite.config.ts)

**Взаимодействие фронт↔бэк:**

- Весь трафик — REST на `/api` через обёртку `src/services/api.ts` с `credentials: 'include'`.
- Сессия — в **httpOnly-cookie** (в state/localStorage токенов нет; в authStore хранится только `accessTokenExpiresAt` для тайминга refresh).
- Write-запросы защищены CSRF double-submit (cookie `csrf_token` + заголовок `X-CSRF-Token`).
- Silent-refresh: при 401 обёртка вызывает `/api/auth/refresh` (single-flight) и повторяет запрос; проактивно `src/hooks/useAuthRefresh.ts` обновляет токен за ~2 мин до истечения.
- Файлы грузятся/скачиваются через серверный proxy `/api/files/...` (не напрямую в S3).

## Ключевые сущности

**Справочники:**

- Контрагент (Counterparty) — справочник поставщиков
- Сотрудник (Employee) — справочник сотрудников
- Объект строительства (ConstructionSite) — справочник объектов
- Тип документа (DocumentType) — справочник типов документов (акты, допуски, лицензии и т.д.)
- Обязательные документы объекта (SiteRequiredDocument) — маппинг: какие документы обязательны для конкретного объекта (настраивается в администрировании)

**Документооборот:**

- Счёт (Invoice) — загруженные счета с OCR-распознаванием
- Спецификация (Specification) — строки счёта (создаются на основе OCR)
- Документ (Document) — прикреплённые документы контрагента/поставки
- Распред. письмо (DistributionLetter / РП) — документ на согласование

**Согласования:**

- Цепочка согласования (ApprovalChain) — конструктор цепочек
- Этап согласования (ApprovalStep) — шаг в цепочке
- Согласование (Approval) — факт согласования/отклонения

**Many-to-many:** суффикс `_mapping` (например, site_required_documents_mapping)

## Роли

- **admin** — полный доступ, включая администрирование (цепочки, документы объектов, OCR)
- **user** — сотрудник компании, весь функционал кроме администрирования
- **counterparty_user** — пользователь контрагента, видит только файлы своего контрагента, может загружать и помечать на удаление свои файлы
- **security** — Отдел СБ, доступ к справочникам

Привязка к контрагенту: `users.counterparty_id` (заполняется только для counterparty_user).
Авторизация — через логику приложения/бэкенда (НЕ через RLS). Защита маршрутов на фронте: `src/components/ProtectedRoute.tsx` (аутентификация) + `src/components/RoleGuard.tsx` (роли). На бэке — middleware `authenticate` + `requireRole`. Фильтрация меню по роли/отделу: `src/layout/MainLayout.tsx`.

## Бизнес-логика

1. Поставщик загружает счёт -> OCR распознаёт -> создаётся спецификация
2. На основе спецификации формируется РП
3. РП проходит цепочку согласований (настраивается в конструкторе)
4. После согласования РП отправляется в заказ
5. Для каждого объекта строительства настраиваются обязательные документы — поставщик обязан их предоставить

## Авторизация (standalone)

- `AUTH_MODE`: `standalone` (собственный стек; startup-инвариант в production) или `supabase-bridge` (legacy, поведение не изменено). Диспетчер — `server/src/routes/auth.ts`.
- Access-токен: JWT HS256 через `jose`, TTL 900с (`JWT_ACCESS_TTL_SECONDS`), подпись `AUTH_JWT_SECRET`.
- Refresh-токен: opaque (43 симв. base64url), в БД хранится только SHA-256-хэш; ротация + reuse-detection + grace-window 5с (`server/src/services/auth/refresh-token.service.ts`).
- Cookie: `access_token` (path `/`), `refresh_token` (path `/api/auth`), `csrf_token` (path `/`, httpOnly=false). В production `secure=true`.
- Rate-limits: login 5/5мин, reset 3/час, глобально 500/мин.
- Keycloak OIDC — **Этап 2 (отложен)**, пока не подключён.

## Администрирование

- Настройка обязательных документов для каждого объекта строительства (маппинг DocumentType <-> ConstructionSite)
- Конструктор цепочек согласований
- Управление справочниками (контрагенты, сотрудники, объекты, типы документов)
- Настройка OCR-моделей (добавление и выбор модели из списка OpenRouter)

## Интеграции

- **Yandex Managed PostgreSQL:** основная БД через Drizzle ORM (SQL-first), драйвер postgres.js; пулер `:6432`, `sslmode=verify-full`, `prepare:false`. Роли: `billhub_runtime` (DML), `billhub_migration` (DDL).
- **Cloud.ru S3:** хранение файлов счетов и документов (S3-совместимый API, presigned/chunked upload); ключи только на сервере (`server/src/services`).
- **OpenRouter.ai:** OCR через vision-модели, вызывается на сервере; выбор модели в настройках.
- **Redis + BullMQ:** очереди обработки файлов и OCR (`server/src/queues`), отдельный worker-процесс.
- **Supabase:** только legacy/rollback-путь (`supabase-bridge`, `@supabase/supabase-js` сохранён по принципу 2). В активном standalone-пути обращений к Supabase нет.

## Инфраструктура / Этапы миграции

Проект мигрировал с клиентского SPA (Supabase напрямую) на клиент-серверную архитектуру и переехал с VPS1+Supabase на **VPS2 + Yandex Managed PostgreSQL**.

- **Этап 1 (выполнен):** собственная авторизация `AUTH_MODE=standalone`, `DB_PROVIDER=drizzle`, полная миграция данных, bcrypt-хэши паролей.
- **Этап 2 (отложен):** Keycloak OIDC.
- Домены (same-origin, path-routing `/` -> web, `/api` -> api): `rp.su10.ru`, `ravek.link`, `www.ravek.link` (один SAN-сертификат).
- Топология: общий ingress `infra-nginx` + certbot обслуживает несколько порталов; BillHub — отдельный compose-проект в `/opt/portals/billhub`. Сервисы: `billhub-api`, `billhub-worker`, `billhub-web`, `redis`, `migrate`. Внешние: Yandex Managed PG, Cloud.ru S3.
- Канонический деплой — каталог `deploy/` (ADR-0007) + `docs/deployment.md`; корневые legacy-файлы деплоя помечены DEPRECATED.
- Деплой через `deploy-billhub` (git pull + build + `up -d`). **Гоча:** `docker compose restart` НЕ перечитывает `env_file` — для применения правок env нужен `up -d` (пересоздание контейнера).

## Переменные окружения

**Frontend (`.env` в корне):**

- `VITE_API_URL` — базовый URL бэкенда (опц.; пусто => относительные `/api`)
- `VITE_MAX_FILE_SIZE_MB` — клиентская валидация размера файла (по умолчанию 100)
- `VITE_SENTRY_DSN` — DSN Sentry (фигурирует в deploy-конфигах, кодом пока не используется)

**Backend (dev — `server/.env`; prod — `/etc/billhub/runtime.env`):**

- Режим: `NODE_ENV`, `PORT`, `CORS_ORIGIN` (список origin через запятую — мультидомен)
- БД (рантайм, DML): `DB_PROVIDER=drizzle`, `DATABASE_URL` (пользователь `billhub_runtime`), `DATABASE_POOL_MAX`, `DATABASE_CONN_LIMIT`, `DATABASE_SSL_CA_PATH`/`PGSSLROOTCERT`, `DATABASE_RUNTIME_USER`
- Авторизация: `AUTH_MODE=standalone`, `AUTH_JWT_SECRET`, `JWT_ISSUER`, `JWT_AUDIENCE`, `JWT_ACCESS_TTL_SECONDS`, `REFRESH_TTL_SECONDS`, `REFRESH_GRACE_MS`, `CSRF_SECRET`, `AUDIT_HMAC_KEY`
- Хранилище: `STORAGE_PROVIDER=cloudru`, `S3_ENDPOINT`/`S3_REGION`/`S3_ACCESS_KEY`/`S3_SECRET_KEY`/`S3_BUCKET` (+ `R2_*` для миграции/rollback)
- OCR/очереди: `OPENROUTER_API_KEY`, `REDIS_URL`, `RUN_WORKERS` (per-container), `OCR_CONCURRENCY`, `FILE_PROCESSING_CONCURRENCY`
- Прочее: `MAX_FILE_SIZE_MB`, `MAIL_STUB_LOG_PATH`, `SENTRY_DSN`
- Supabase (только legacy/rollback, принцип 2): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`

**Backend (миграции — prod `/etc/billhub/migration.env`):**

- `DATABASE_MIGRATION_URL` (пользователь `billhub_migration`, DDL), `DATABASE_SSL_CA_PATH`/`PGSSLROOTCERT`

Правила по env:

- НЕ читать, НЕ искать, НЕ модифицировать файлы `.env`
- При необходимости указать какие переменные нужны, но не запрашивать значения

## Стиль кода

- **Максимум 600 строк на файл** — разбивать на компоненты/модули
- Functional React components с хуками
- Async/await для асинхронных операций
- camelCase для переменных, PascalCase для компонентов
- **Комментарии ТОЛЬКО на русском языке**
- **Коммуникация в чате ТОЛЬКО на русском языке**
- Ant Design для всех UI-компонентов
- Responsive design (desktop + mobile)

## Декомпозиция компонентов

- **Максимум 600 строк на файл** — при превышении обязательно разбивать
- Модальные окна с собственным состоянием — выносить в отдельные компоненты
- Повторяющиеся блоки в разных файлах — выносить в общий компонент
- Утилитные функции (форматирование, валидация) — выносить в `src/utils/`
- Хуки с логикой загрузки данных / фильтрации — выносить в `src/hooks/`
- Формы внутри модалок — выносить при превышении 100 строк

## Безопасность кода

- Никогда не использовать `select('*')` — явно перечислять поля (и в Drizzle-запросах, и в raw SQL)
- Валидировать returnUrl/redirectUrl: только относительные пути (начинается с `/`, не начинается с `//`)
- Санитизировать имена файлов при создании ZIP-архивов (удалять `..`, `\`, `/`)
- Ограничивать размер загружаемых файлов через `MAX_FILE_SIZE_MB` (сервер) / `VITE_MAX_FILE_SIZE_MB` (клиент), по умолчанию 100 МБ
- Проверять тип файла по magic bytes, не только по расширению/MIME (`src/utils/fileValidation.ts`)
- Логирование: на фронте — через `logError()` из `src/services/errorLogger.ts` (в таблицу `error_logs`, просмотр в админке); на бэке — через `pino` (без `console.log`), с редакцией чувствительных полей
- Секреты (ключи S3/OpenRouter/БД, JWT-секреты) — только на сервере; НЕ передавать в клиентский state и НЕ хранить в `VITE_*`

## Коммуникация

- НЕ выводить код в ответах — только описание изменений
- НЕ использовать эмодзи
- Писать лаконично
- Указывать какие файлы изменены и что перезапустить

## Ключевые принципы

- Ant Design для всех UI-компонентов
- Responsive design (desktop + mobile)
- Файлы хранить ТОЛЬКО через Cloud.ru S3 (доступ с сервера, `server/src/services`)
- Секреты — только на сервере; фронтенд без секретов
- Авторизация — через логику приложения/бэкенда, без RLS

## Работа с задачами

**ОБЯЗАТЕЛЬНО перед выполнением:**

1. Проанализировать задачу на наличие разных вариантов решения
2. Если есть варианты — описать плюсы/минусы и спросить разработчика
3. Приступать только после подтверждения

**Уточнять:** добавление полей БД, рефакторинг, архитектурные изменения, разные подходы.
**Не уточнять:** очевидные исправления, чёткие задачи, стандартный CRUD.

## Требования к планам

При создании плана в режиме планирования (plan mode):

**НЕ включать в план:**

- Код (даже примеры или фрагменты)
- Списки изменяемых файлов
- Детальные пошаговые инструкции по редактированию

**ВКЛЮЧАТЬ в план:**

- Архитектуру изменений (общая структура решения)
- Изменения в структуре БД (новые таблицы, поля, связи, индексы)
- Архитектуру результата (как будет работать после изменений)
- Способы проверки работоспособности (как протестировать результат)

План должен быть высокоуровневым и архитектурным, без технических деталей реализации.

## База данных (Yandex Managed PostgreSQL + Drizzle)

**Схема БД:** `sql/schema/schema.json` — перед работой с таблицами, связями и полями ОБЯЗАТЕЛЬНО сверяться с этим файлом.

Доступ — через Drizzle ORM (SQL-first, драйвер postgres.js). Runner миграций — `server/src/cli/migrate.ts` (журнал `_migrations`, checksum, накат только отсутствующих; `assertNotSupabase` блокирует применение к Supabase-хосту).

### ЗАПРЕЩЕНО:

- RLS (Row Level Security) — авторизация через логику приложения
- Автоматическое создание/изменение таблиц без согласования
- Изменения структуры БД без согласования

### РАЗРЕШЕНО:

- Изменения только через миграции в `sql/migrations/` (нумерация с `0001`): показать -> одобрить -> запустить

### ВАЖНО по миграциям:

- При доработке в следующем запросе НЕ ДОПИСЫВАТЬ в существующий файл миграции
- ВСЕГДА создавать новую миграцию с расчётом на то, что предыдущая уже запущена
- Новая миграция должна учитывать состояние БД после применения предыдущей

## Документация

### ЗАПРЕЩЕНО:

- MD файлы в корне проекта (кроме README.md, CLAUDE.md)
- Отчётные документы о выполненных задачах
- Файлы с инструкциями после работы

### РАЗРЕШЕНО:

- Временные файлы в `temp/` (при крайней необходимости)
- Все объяснения — в чате

## Git

- НЕ создавать коммиты
- НЕ пушить на GitHub
- Разработчик сам управляет Git
