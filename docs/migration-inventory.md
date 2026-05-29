# BillHub: Migration Inventory

Чек-лист и инвентаризация для миграции на Yandex Managed PostgreSQL + Cloud.ru S3 (Этап 1).

**Зафиксировано:** 2026-05-30 (Iteration 0).
**Будет уточнено** в итерации 8 (подготовка инфры) и в итерации 9 (полная репетиция с данными).

---

## 1. Таблицы (42 в текущей публичной схеме)

Источник: `sql/schema/schema.json` + миграции `001`–`006`.

```
approval_decision_files
approval_decisions
comment_read_status
construction_sites
contract_comment_read_status
contract_request_comments
contract_request_files
contract_requests
cost_types
counterparties
counterparty_security_checks      # из миграции 001
distribution_letters
document_types
documents
employees
error_logs
founding_document_files
invoices
materials_dictionary
notifications                      # +counterparty_id (m001), +supplier_id (m002)
ocr_models
ocr_recognition_log
payment_payment_files
payment_payments
payment_request_assignments
payment_request_comments
payment_request_field_options
payment_request_files
payment_request_logs
payment_requests                   # m004 cleanup of withdrawn_at
recognized_materials
request_number_sequence
settings
site_required_documents_mapping
specifications
statuses                           # m005 добавила contract 'rejected'
supplier_founding_documents        # m003 — связано с founding_documents_comment
supplier_security_checks           # из миграции 002
suppliers                          # m003 founding_documents_comment; m006 last_security_status
upload_tasks
user_construction_sites_mapping
users                              # m001 расширила users.role до 4 значений
```

### Несоответствие `schema.json` vs миграции

- ✅ Миграции 001, 002, 003 — отражены в `schema.json`.
- ❌ Миграция **006** (`suppliers.last_security_status`) — НЕ отражена. **Schema.json устарел на 1 миграцию.**
- ✅ Миграции 004 (data cleanup) и 005 (INSERT в `statuses`) — schema-нейтральны.

**Действие:** перегенерировать `sql/schema/schema.json` (итерация 1 cutover-critical track).

### Системные / не-public таблицы (Supabase)

- `auth.users` — содержит `email`, `encrypted_password` (bcrypt). **Импортируется** в `users.password_hash` через `import-passwords.ts`.
- `auth.audit_log_entries`, `auth.flow_state`, `auth.refresh_tokens` — Supabase-системные, **не переносятся**.
- `storage.*` — Supabase Storage; **мы её не используем** (файлы в R2/Cloud.ru).
- `realtime.*` — Supabase Realtime; **мы её не используем**.

В `pg_dump` команде в [ADR-0003](adr/0003-cutover-db-strategy.md) явно исключается всё перечисленное.

---

## 2. SQL-функции (5)

Источник: `sql/schema/schema.json`.

| Имя | Назначение | План на Этап 1 |
|---|---|---|
| `change_user_password(...)` | Смена пароля юзером (вызывает Supabase auth.users) | **Заменяется** новой реализацией в Node (bcrypt в `users.password_hash`) в рамках standalone auth (итерация 6). Функция в БД остаётся как `plpgsql`-обёртка над новой таблицей или удаляется (решение в итерации 6). |
| `generate_request_number(...)` | Атомарная нумерация заявок на оплату | **Остаётся** как plpgsql, вызывается через `db.execute(sql\`SELECT generate_request_number($1)\`)` из Drizzle-репозитория. |
| `generate_contract_request_number(...)` | Атомарная нумерация заявок на договор | **Остаётся** как plpgsql. |
| `list_counterparties_with_sb(...)` | Серверная пагинация контрагентов с агрегатами СБ (RPC) | **Остаётся** как SQL-функция. Drizzle-репозиторий вызывает её через `db.execute`. |
| `list_suppliers_with_sb(...)` | То же для поставщиков (миграция 002) | **Остаётся** как SQL-функция. |

Все функции включены в `pg_dump --schema-only`, поэтому baseline-миграция `0000_baseline.sql` их содержит.

---

## 3. RPC-вызовы из бэкэнда

Грепом `.rpc(` по `server/src/` (см. ранние наблюдения):

| Файл | RPC | Назначение |
|---|---|---|
| `routes/payment-requests.ts` | `generate_request_number` | Создание заявки на оплату |
| `routes/contract-requests.ts` | `generate_contract_request_number` | Создание заявки на договор |
| `routes/references/counterparties.ts` | `list_counterparties_with_sb` | Список контрагентов с СБ-агрегатами |
| `routes/references/suppliers.ts` | `list_suppliers_with_sb` | Список поставщиков с СБ-агрегатами |
| `routes/health.ts` | `(не RPC, но проверка БД)` | Health-check |

Также `change_user_password` вызывается из routes/auth.ts (смена пароля юзером).

В Drizzle-репозиториях RPC заменяются на `db.execute(sql\`SELECT * FROM list_counterparties_with_sb($1,$2,...)\`)` с типизированным mapping результатов.

---

## 4. S3-keys: схемы и инвентаризация

Источник: `server/src/routes/files.ts`, функция `buildFileKey()`.

| context | Шаблон ключа | Префикс |
|---|---|---|
| `request` | `{counterparty}/{requestNumber}/{timestamp}_{filename}` | `{counterparty}/{requestNumber}/` |
| `decision` | `approval-decisions/{entityId}/{timestamp}_{filename}` | `approval-decisions/` |
| `payment` | `{counterparty}/payment/{entityId}/{timestamp}_{filename}` | `{counterparty}/payment/` |
| `contract` | `{counterparty}/contract/{entityId}/{timestamp}_{filename}` | `{counterparty}/contract/` |
| `general` | `{counterparty}/{timestamp}_{filename}` | `{counterparty}/` |
| `founding` | `founding-docs/{entityId}/{timestamp}_{filename}` | `founding-docs/` |

`{counterparty}` — sanitized имя контрагента (транслитерация + замена пробелов на `_`, удаление спецсимволов; см. `server/src/utils/sanitize.ts`).

### Поля БД, содержащие ключи

| Таблица | Поле | Контексты |
|---|---|---|
| `payment_request_files` | `file_key` | request |
| `contract_request_files` | `file_key` | contract |
| `payment_payment_files` | `file_key` | payment |
| `approval_decision_files` | `file_key` | decision |
| `founding_document_files` | `file_key` | founding |
| `documents` | `file_key` (или эквивалент) | general |
| `invoices`, `specifications` | косвенно через `payment_request_files` | request |

При cutover файлов **ключи не меняются** (см. [ADR-0004](adr/0004-cutover-files-strategy.md)). Никаких UPDATE в БД не требуется, если в R2 нет легаси-префиксов. Проверка фактического состава ключей в R2 — итерация 9.

### Текущий объём (to be measured)

- **Количество объектов в R2** — _TBD в итерации 9_ (через `aws s3 ls --recursive --summarize`).
- **Суммарный объём** — _TBD_.
- **Распределение по префиксам** — _TBD_ (для оценки времени `rclone copy`).

---

## 5. Connection budget

Формула из корпстандарта v3 раздел 7:

```
conn_limit >= VM_count × process_count × pool.max + reserve
```

### Этап 1 (1 VPS, 2 процесса: API + worker)

- `pool.max` = 10 (по умолчанию `postgres.js`).
- VM_count = 1.
- process_count = 2 (API + worker).
- reserve = 5 (admin / health checks).

`conn_limit billhub_runtime ≥ 1 × 2 × 10 + 5 = 25`.

**Установка в Yandex Managed PG: `ALTER USER billhub_runtime CONNECTION LIMIT 30`** (с небольшим запасом).

`billhub_migration` — отдельный пользователь, `CONNECTION LIMIT 5` (только migration runner).

### Этап 2 (2 backend VM + Keycloak)

- `billhub_runtime`: 2 × 2 × 10 + 5 = 45. **Поднимется до `CONNECTION LIMIT 50`** в Этапе 2.
- `keycloak_runtime`: 2 × 1 × 10 + 5 = 25. **`CONNECTION LIMIT 30`**.

Лимит Yandex Managed PG `max_connections` по умолчанию 200 — перекрывает суммарный budget (~85) с большим запасом.

---

## 6. Расширения PostgreSQL

Корпстандарт v3 раздел 8: расширения включает администратор кластера **ДО** запуска миграций; в SQL-миграциях `CREATE EXTENSION` запрещён.

Требуемые:
- `pgcrypto` — для `gen_random_uuid()` (используется массово в default-ах PK).
- `citext` — может быть полезно для регистронезависимого email (опционально; включаем для будущего).
- `pg_trgm` — для индексов LIKE/ILIKE (используется в RPC `list_*_with_sb` для поиска).

Действие в итерации 8: запрос на включение расширений в Yandex Managed PG.

---

## 7. Текущие connection counts (baseline)

Метрика для сверки после cutover (новая VPS должна показывать сравнимое число открытых соединений к Yandex PG):

- Текущее `SELECT count(*) FROM pg_stat_activity WHERE usename='<service-role>'` на Supabase — _TBD в итерации 8_ (через Supabase Dashboard).
- Ожидаемое на новой инфре — 5–15 в обычном режиме (1 backend × pool.max=10 + транзитные).

---

## 8. Environment-переменные (новые / меняющиеся)

### Удаляются с новой VPS

(Supabase-переменные больше не нужны на новой инфре, но из `.env.example` НЕ удаляются по принципу 2 — `@supabase/supabase-js` остаётся в коде для rollback/migration скриптов.)

### Добавляются

```
# Yandex Managed PostgreSQL
DATABASE_URL=postgresql://billhub_runtime:<secret>@<host>:6432/billhub_db?sslmode=verify-full
DATABASE_MIGRATION_URL=postgresql://billhub_migration:<secret>@<host>:6432/billhub_db?sslmode=verify-full
DATABASE_POOL_MAX=10
DATABASE_SSL_CA_PATH=/etc/yandex-pg/ca.crt

# Feature-флаги
DB_PROVIDER=drizzle               # standalone-инвариант в production
AUTH_MODE=standalone              # в Этапе 1
STORAGE_PROVIDER=cloudru          # на новой инфре

# Cloud.ru S3 (уже описаны в .env.example, на новой VPS заполняются)
S3_ENDPOINT=https://s3.cloud.ru
S3_REGION=ru-msk
S3_ACCESS_KEY=...
S3_SECRET_KEY=...
S3_BUCKET=billhub-s3

# Auth (новые)
JWT_ISSUER=https://billhub.local       # для standalone JWT
JWT_AUDIENCE=billhub
JWT_PRIVATE_KEY_PATH=/run/secrets/jwt_private_key
JWT_PUBLIC_KEY_PATH=/run/secrets/jwt_public_key
JWT_ACCESS_TTL_SECONDS=900
REFRESH_TTL_SECONDS=2592000        # 30 дней
CSRF_SECRET=...                    # для double-submit cookie

# Audit
AUDIT_HMAC_KEY=...                 # для email_hmac в audit_log

# Workers
WORKER_CONCURRENCY=3               # как сейчас для OCR_CONCURRENCY
```

### Остаются без изменений

```
PORT=3000
NODE_ENV=production
CORS_ORIGIN=https://billhub.ru
REDIS_URL=redis://redis:6379
OPENROUTER_API_KEY=...
MAX_FILE_SIZE_MB=100
```

---

## 9. Артефакты cutover

Сохраняются в репозитории (под `docs/cutover-artifacts/`) для аудита и отладки:

- `manifest_r2_T1.json` — снимок R2 за дни до cutover.
- `manifest_r2_cutover.json` — снимок R2 в окне.
- `manifest_cloudru_cutover.json` — снимок Cloud.ru после финальной синхронизации.
- `rclone_check_cutover.log` — лог `rclone check`.
- `cutover_db_pg_restore.log` — лог `pg_restore`.
- `cutover_smoke_playwright.html` — отчёт Playwright smoke.
- `cutover_timeline.md` — фактический таймлайн событий в окне (заполняется live).

---

## 10. Команда и контакты (to be filled)

- **Cutover owner:** _TBD_.
- **DBA:** _TBD_.
- **DevOps:** _TBD_.
- **Backend lead:** _TBD_.
- **Frontend lead:** _TBD_.
- **QA:** _TBD_.
- **Communications (notify users):** _TBD_.
- **Yandex Cloud support:** _TBD_ (контракт / контакт).
- **Cloud.ru support:** _TBD_.
- **Cloudflare R2 support:** _TBD_.
