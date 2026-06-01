# Runbook: Yandex Managed PostgreSQL для BillHub (Этап 1, Iteration 8)

Операторский (administrator) runbook создания кластера Yandex Managed Service for PostgreSQL
под BillHub. Выполняется **до** bootstrap схемы. Все шаги — операции оператора (Yandex Cloud
Console / `yc` CLI); AI готовит этот документ, не выполняет инфраструктурные операции.

Связанные документы:

- [docs/runbook-vps-migration.md](../docs/runbook-vps-migration.md) — подготовка VPS.
- [docs/adr/0005-rpo-rto.md](../docs/adr/0005-rpo-rto.md) — connection budget, RPO/RTO.
- [sql/bootstrap/roles.sql](../sql/bootstrap/roles.sql) — роли БД.
- [scripts/bootstrap-schema.sh](bootstrap-schema.sh) — применение схемы.

---

## 1. Параметры кластера

| Параметр           | Значение                                                                           | Обоснование                                                                              |
| ------------------ | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Версия PostgreSQL  | 17 (или 16, если 17 недоступна)                                                    | `schema.sql` снят с PG 17.6; фильтр убирает `transaction_timeout` для совместимости с 16 |
| Окружение          | `PRODUCTION`                                                                       | бэкапы + гарантии SLA                                                                    |
| Hosts              | **master + sync replica** (2 хоста, разные зоны: `ru-central1-a`, `ru-central1-b`) | HA, синхронная репликация = RPO 0 на уровне кластера                                     |
| Resource preset    | `s2.medium` (2 vCPU / 8 GB) или выше                                               | под рабочую нагрузку Этапа 1                                                             |
| Disk               | `network-ssd`, 50 GB (autoscaling до 100 GB)                                       | объём БД ≤ 50 GB (ADR-0003)                                                              |
| Имя БД             | `billhub_db`                                                                       |                                                                                          |
| Connection pooling | PgBouncer (Yandex встроенный), порт **6432**, режим `transaction`                  | соответствует `DATABASE_URL ...:6432/...`                                                |

> **PgBouncer transaction mode + prepared statements:** runtime использует `postgres.js`.
> В коде пул создаётся с `prepare: false` для migration runner; для runtime-пула в transaction-mode
> также держим `prepare: false` (см. `DATABASE_POOL_MAX`, плагин `database-drizzle`). Если включить
> session-mode pooler — можно вернуть prepared statements, но это меняет connection budget.

### Создание (`yc` CLI, пример — оператор подставляет реальные id сети/подсети)

```bash
yc managed-postgresql cluster create \
  --name billhub-pg \
  --environment production \
  --network-id "$NETWORK_ID" \
  --resource-preset s2.medium \
  --disk-type network-ssd --disk-size 50 \
  --postgresql-version 17 \
  --host zone-id=ru-central1-a,subnet-id="$SUBNET_A",assign-public-ip=true \
  --host zone-id=ru-central1-b,subnet-id="$SUBNET_B",assign-public-ip=true \
  --database name=billhub_db,owner=billhub_owner \
  --user name=billhub_owner,password="$OWNER_PASSWORD" \
  --connection-pooler-mode transaction
```

`assign-public-ip=true` — нужен, т.к. VPS вне Yandex VPC ходит к кластеру через публичный
FQDN-хост с TLS. Если VPS будет в той же VPC (Этап 2) — публичный IP не нужен.

---

## 2. Расширения PostgreSQL (ДО миграций)

Стандарт v3 §8: расширения включает администратор кластера; в SQL-миграциях `CREATE EXTENSION`
запрещён (фильтр `bootstrap-schema.sh` их и удаляет). Включить через Console или CLI:

```bash
yc managed-postgresql cluster update billhub-pg \
  --extensions pgcrypto,citext,pg_trgm
```

- `pgcrypto` — `gen_random_uuid()` в DEFAULT всех PK (в PG 13+ доступна и из pg_catalog, но
  включаем явно по стандарту).
- `citext` — регистронезависимый email (на вырост; startup-checks ожидают наличие).
- `pg_trgm` — индексы LIKE/ILIKE в RPC `list_*_with_sb`.

Production startup checks (`REQUIRED_PG_EXTENSIONS`) проверяют наличие всех трёх и валят старт
backend при отсутствии. Проверка:

```sql
SELECT extname FROM pg_extension WHERE extname IN ('pgcrypto','citext','pg_trgm');
-- ожидается 3 строки
```

---

## 3. TLS verify-full + Yandex CA

Кластер принимает только TLS. На VPS положить Yandex CA:

```bash
sudo mkdir -p /etc/yandex-pg
sudo curl -s https://storage.yandexcloud.net/cloud-certs/CA.pem \
  -o /etc/yandex-pg/ca.crt
sudo chmod 644 /etc/yandex-pg/ca.crt
```

В строках подключения — `?sslmode=verify-full`; путь к CA задаётся через `PGSSLROOTCERT`
(psql / migration runner) и `DATABASE_SSL_CA_PATH` (runtime-пул). Startup-check `checkSslMode`
валит старт, если в `DATABASE_URL` нет `sslmode=verify-full`.

Проверка с VPS:

```bash
PGSSLROOTCERT=/etc/yandex-pg/ca.crt \
  psql "postgresql://billhub_runtime:***@<FQDN-master>:6432/billhub_db?sslmode=verify-full" \
  -c "SELECT version();"
```

---

## 4. Роли БД

Применить [sql/bootstrap/roles.sql](../sql/bootstrap/roles.sql) под владельцем кластера
(`billhub_owner`), предварительно заменив оба `CHANGE_ME` на сильные пароли:

```bash
PGSSLROOTCERT=/etc/yandex-pg/ca.crt \
  psql "postgresql://billhub_owner:***@<FQDN-master>:6432/billhub_db?sslmode=verify-full" \
  -v ON_ERROR_STOP=on -f sql/bootstrap/roles.sql
```

Результат:

- `billhub_migration` (DDL, CONNECTION LIMIT 5) — для bootstrap-schema.sh и migrate.js.
- `billhub_runtime` (DML + EXECUTE, CONNECTION LIMIT 30, без CREATE/DROP/ALTER) — для backend/worker.

`DEFAULT PRIVILEGES FOR ROLE billhub_migration` гарантирует, что таблицы/функции, создаваемые
миграциями под billhub_migration, автоматически доступны billhub_runtime на DML/EXECUTE.

---

## 5. Allowlist (security groups)

Кластеру доступ только со **статического публичного IP** VPS:

```bash
# Security group VPC, к которой привязан кластер: разрешить 6432/tcp с NEW_VPS_IP/32.
yc vpc security-group update-rules "$PG_SECURITY_GROUP_ID" \
  --add-rule "direction=ingress,port=6432,protocol=tcp,v4-cidrs=[$NEW_VPS_IP/32]"
```

`OLD_VPS_IP` в allowlist НЕ добавляется (старый прод ходит в Supabase, не в Yandex PG — принцип 1).

---

## 6. Бэкапы + PITR

- Yandex Managed PG делает автоматические бэкапы. Установить **retention 7–14 дней**:

```bash
yc managed-postgresql cluster update billhub-pg \
  --backup-retain-period-days 14 \
  --backup-window-start 02:00
```

- **PITR** (point-in-time recovery) доступен в пределах retention из непрерывного WAL-архива.
- **Backup-restore rehearsal:** перед cutover и далее ежеквартально прогонять
  [scripts/backup-restore-rehearsal.sh](backup-restore-rehearsal.sh) — restore последнего бэкапа
  в отдельный тестовый кластер + smoke (расширения, `_migrations`, ключевые таблицы). Источник
  read-only (принцип 1).

---

## 7. Bootstrap схемы (после шагов 1–6)

На VPS, при собранном server (`npm --prefix server run build`):

```bash
export DATABASE_MIGRATION_URL="postgresql://billhub_migration:***@<FQDN-master>:6432/billhub_db?sslmode=verify-full"
export PGSSLROOTCERT=/etc/yandex-pg/ca.crt
bash scripts/bootstrap-schema.sh
```

Скрипт: sed-фильтрация `sql/schema/schema.sql` → `psql` (ON_ERROR_STOP) → `migrate.js` (0001/0002/0003).
`assertNotSupabase()` в runner-е и shell-guard в скрипте не дадут подать Supabase-URL (принцип 1).

Проверка после bootstrap:

```sql
SELECT max(version) FROM public._migrations;      -- ожидается 3
SELECT count(*) FROM information_schema.tables
 WHERE table_schema='public' AND table_type='BASE TABLE';
SELECT to_regclass('public.users'), to_regclass('public.refresh_tokens'),
       to_regclass('public.outbox'), to_regclass('public.audit_log'),
       to_regclass('public.jobs_log');             -- все не NULL
```

---

## 8. Чек-лист готовности (Operator Gate, не блокирует AI Gate)

- [ ] Кластер `billhub-pg`: master + sync replica, PG 17/16, PRODUCTION.
- [ ] Расширения `pgcrypto`, `citext`, `pg_trgm` включены (3 строки в `pg_extension`).
- [ ] TLS verify-full работает с `/etc/yandex-pg/ca.crt`.
- [ ] Роли `billhub_runtime` (limit 30) и `billhub_migration` (limit 5) созданы.
- [ ] Allowlist: только `NEW_VPS_IP/32` на порт 6432.
- [ ] Бэкапы retention 14 дней; PITR активен.
- [ ] `bootstrap-schema.sh` отработал: `max(version)=3`, ключевые таблицы на месте.
- [ ] Latency с VPS: `scripts/check-pg-latency.ts` — median ≤ 30 мс, p95 ≤ 50 мс.
