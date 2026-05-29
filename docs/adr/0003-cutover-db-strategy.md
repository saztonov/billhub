# ADR-0003: Стратегия cutover БД Supabase → Yandex Managed PostgreSQL

**Status:** accepted (2026-05-30)

## Context

Этап 1 переводит БД BillHub с Supabase Cloud на Yandex Managed PostgreSQL. На момент cutover в Supabase 42 таблицы (см. [migration-inventory.md](../migration-inventory.md)) + системная схема `auth` с пользовательскими credentials (bcrypt-хэши). Объём БД на момент написания ADR — порядка единиц GB (точная оценка проводится в итерации 8 перед cutover).

Принцип миграции 1: **старая инфра не модифицируется до cutover** — никакой двойной записи, никакого CDC из старого backend.

Принцип 4: cutover только после полного прохождения функциональных и нагрузочных тестов на новой инфре (итерация 9).

Из этих ограничений возникает вопрос: какой механизм синхронизации данных Supabase → Yandex PG использовать в cutover-окне?

## Decision

**Полный `pg_dump --data-only` + `pg_restore` в read-only окне.**

### Конкретная процедура

1. **За 1–2 недели до cutover (итерация 9):** в Yandex PG развёрнута пустая схема (baseline `0000_baseline.sql` + миграции 001…006 + новые 0007/0008 уже применены). В неё `pg_restore`-ится копия данных из Supabase на момент T1; на этой копии прогоняются функциональные + нагрузочные тесты. Это «генеральная репетиция» данной процедуры.
2. **В cutover-окне (итерация 10):**
   - Старая VPS переводится в read-only (frontend show maintenance, backend отклоняет write); это единственное изменение на старом проде за всё время Этапа 1.
   - С Supabase делается `pg_dump --data-only --no-owner --no-privileges --schema=public --schema=auth -Fc -f cutover.dump` (custom format для параллельного restore).
   - На Yandex PG: `pg_restore -d billhub_db --data-only --no-owner --no-privileges -j 4 cutover.dump`. Параллелизм 4 для ускорения.
   - Скрипт `import-passwords.ts` переносит `auth.users.encrypted_password` → `users.password_hash`.
   - Smoke + DNS-switch.

### Почему именно полный re-restore, а не инкрементальная синхронизация

- **Простота.** Полный dump → restore — один шаг, понятный любому DBA. Нет дельта-логики, которая может ошибиться.
- **Атомарность.** В пределах окна — read-only старый → dump → restore → smoke → DNS. Промежуточных состояний нет.
- **Объём данных позволяет.** Текущая оценка — единицы GB. `pg_dump -Fc + pg_restore -j 4` для такого объёма укладывается в 15–30 минут, что приемлемо в окне 2–4 часа (см. [ADR-0005](0005-rpo-rto.md)).

### Что НЕ используется и почему

- **`pg_dump`-инкрементальный режим** — его не существует; `pg_dump` всегда делает полный снимок (это была неточность в раннем драфте плана).
- **Logical replication (`pg_logical`)** — мощный механизм, но требует:
  - DDL на старом проде для создания publication — нарушает принцип 1.
  - Управления replication slot и LSN — оперативная сложность.
  - Времени для catch-up и проверки консистентности.
  - **Альтернативный сценарий:** если объём БД на момент итерации 8 окажется >50 GB и полный re-restore не укладывается в окно — переходим на logical replication по отдельному уточняющему ADR. Это даёт возможность держать Yandex PG в синхроне с Supabase за дни до cutover и в окне cutover делать только финальный «cut» (несколько минут вместо часов).
- **Custom delta-скрипты по `updated_at`** — отвергнуты как ненадёжные: легко пропустить таблицы без `updated_at`, тяжело отлаживать в окне cutover.
- **Двойная запись через backend** — отвергнута (см. принцип 1: старый прод не модифицируется).

## Procedure (cutover-окно, итерация 10)

```bash
# 0. Перевод в read-only
#    На старой VPS: nginx serves maintenance page; backend отклоняет write.

# 1. Snapshot Supabase
PGPASSWORD=<supabase_password> pg_dump \
  -h db.<project>.supabase.co -U postgres -d postgres \
  --data-only \
  --no-owner --no-privileges \
  --schema=public --schema=auth \
  --exclude-table-data='auth.audit_log_entries' \
  --exclude-table-data='auth.flow_state' \
  -Fc -f cutover.dump

# 2. Restore в Yandex PG
PGPASSWORD=<yandex_billhub_migration_password> pg_restore \
  -h <managed-pg-host> -U billhub_migration -d billhub_db \
  --data-only --no-owner --no-privileges \
  -j 4 \
  cutover.dump

# 3. Import passwords
node server/dist/cli/import-passwords.js \
  --source supabase \
  --target yandex \
  --verify-sample 100

# 4. Smoke
node server/dist/cli/smoke.js --base-url https://temp.billhub.ru

# 5. DNS switch (вне этого скрипта)
```

### Verification после restore

- `SELECT count(*) FROM information_schema.tables WHERE table_schema='public'` — 42 таблицы.
- `SELECT count(*) FROM users` — совпадает с Supabase.
- `SELECT count(*) FROM payment_requests` — совпадает.
- `SELECT count(*) FROM contract_requests` — совпадает.
- `SELECT count(*) FROM users WHERE password_hash IS NOT NULL` — все импортированы.
- Проверка 100 случайных пользователей: попытка логина прежним паролем (тестовый скрипт через `bcrypt.compare`).

## Consequences

**Плюсы:**
- Один проверяемый шаг, минимум подвижных частей.
- Полная репетиция в итерации 9 (на копии данных) даёт уверенность в процедуре до окна.
- pg_dump/pg_restore — стандартные инструменты; runbook понятен любому DBA.

**Минусы:**
- В cutover-окне ВСЕ write-операции пользователей блокируются на 15–30 минут (read-only).
- Если объём вырастет >50 GB — окно становится неприемлемым, потребуется переход на logical replication (резервный сценарий).
- Между моментом `pg_dump` и моментом `pg_restore` Supabase в read-only — никаких write на старом проде, никаких на новом. Latency окна = время restore + smoke + DNS propagation.

## Alternatives

| Вариант | Плюсы | Минусы | Решение |
|---|---|---|---|
| Полный re-restore (выбран) | Простота, атомарность | Окно read-only 15–30 мин | ✅ |
| Logical replication | Cutover-окно несколько минут | DDL на Supabase (нарушает принцип 1), сложность slot/LSN | Резерв если объём >50 GB |
| pg_dumpall с восстановлением через `pg_restore --clean` | Включает roles/grants | Лишние объекты Supabase-системы | Нет (роли мы создаём отдельно) |
| Двойная запись через backend | Нет окна downtime | Изменения на старом проде (нарушает принцип 1) | ❌ |
| Custom delta по `updated_at` | Минимум downtime | Не покрывает таблицы без updated_at, тяжёлая отладка | ❌ |

## Связанные ADR

- [ADR-0001: Отклонения от стандарта v3](0001-deviations-from-corp-standard.md)
- [ADR-0005: RPO/RTO](0005-rpo-rto.md) — окно read-only вписывается в RTO 2–4 ч.
- [ADR-0006: Rollback процедура](0006-rollback-procedure.md) — что делать, если restore провалился.
