# Cutover 1 Runbook — Supabase + R2 → Yandex PG + Cloud.ru S3

Операционный плейбук дня cutover (Этап 1, Iteration 10). Каждый шаг окна автоматизирован скриптом из
[`scripts/cutover/`](../scripts/cutover/) (12 шагов + rollback). РЕАЛЬНЫЙ cutover выполняет **оператор**;
скрипты идемпотентны, shellcheck-чистые, логируют в `/var/log/cutover/` + stdout, поддерживают `DRY_RUN=1`.

**Архитектурные решения:** [docs/adr/](adr/) · **Инвентаризация/контакты:** [migration-inventory.md](migration-inventory.md)
**Rollback:** [runbook-rollback.md](runbook-rollback.md) ([ADR-0006](adr/0006-rollback-procedure.md)) ·
**Инциденты:** [runbook-incident-response.md](runbook-incident-response.md)

---

## 0. Переменные окружения окна

Заполняются оператором (значения среды — НЕ в репозитории; секреты в `./server/.env`, права 600).

```bash
# Старый прод (read-only в окне; принцип 1)
export OLD_VPS_SSH="deploy@old.billhub.<домен>"
export OLD_BASE_URL="https://billhub.<домен>"
# Новая VPS
export NEW_VPS_SSH="deploy@new.billhub.<домен>"
export NEW_BASE_URL="https://billhub.<домен>"          # после DNS-switch — основной домен
export TEMP_BASE_URL="https://temp.billhub.<домен>"    # temp-домен (basic-auth) до switch
export PROD_BASE_URL="https://billhub.<домен>"
# БД
export SUPABASE_DB_URL="postgresql://postgres:***@db.<project>.supabase.co:5432/postgres"   # read-only источник
export DATABASE_MIGRATION_URL="postgresql://billhub_migration:***@<yandex>:6432/billhub_db?sslmode=verify-full"
export DATABASE_URL="postgresql://billhub_runtime:***@<yandex>:6432/billhub_db?sslmode=verify-full"
# S3 / rclone — remotes r2: и cloudru: настроены в rclone.conf; endpoints/профили — см. cloudru-s3-setup.md
export CLOUDRU_ENDPOINT="https://s3.cloud.ru" R2_ENDPOINT="https://<account>.r2.cloudflarestorage.com"
# Smoke
export E2E_ADMIN_EMAIL=... E2E_ADMIN_PASSWORD=... # и аналогично user/cp/security (реальные учётки копии)
```

---

## 1. Pre-cutover (за 1–2 недели до окна)

### 1.1 Готовность кодовой базы
- [ ] Итерации 0–9 cutover-critical слиты в `main`; CI на `main` зелёный (lint + tsc + tests + build).
- [ ] `npm audit --omit=dev` без high/critical; Drizzle introspect-drift зелёный.
- [ ] Production startup checks падают при placeholder (unit-тест `startup-checks`).

### 1.2 Готовность инфраструктуры
- [ ] Новая VPS: `/api/health/ready`=200 на temp-домене; Yandex PG (master + sync replica), расширения,
      пользователи, `conn_limit` (см. [migration-inventory §5](migration-inventory.md)), бэкапы + PITR;
      latency ≤30 мс ([check-pg-latency](../scripts/check-pg-latency.ts)).
- [ ] Cloud.ru S3 bucket + allowlist статического IP новой VPS; HEAD bucket OK.
- [ ] R2 → Cloud.ru первичный `rclone copy` завершён; `rclone check --size-only` 0 расхождений;
      byte-range audit 50/50; манифесты сохранены ([cutover-artifacts](cutover-artifacts/)).
- [ ] `import-passwords` проверен на 100 пользователях; backup-restore rehearsal Yandex PG прорепетирован.
- [ ] `delta-replay-yandex-to-supabase.ts` реализован и покрыт unit-тестами.

### 1.3 Готовность процедуры
- [ ] **Отчёт Iteration 9** заполнен с `ИТОГ: PASS` ([iteration-9-report.md](cutover-artifacts/iteration-9-report.md)).
- [ ] Репетиция rollback Сценарии A и B на staging зелёная ([cutover-rehearsal-plan.md](cutover-rehearsal-plan.md)).
- [ ] Контакты incident-команды заполнены и подтверждены ([migration-inventory §10](migration-inventory.md)).
- [ ] Канал инцидента создан; вся команда уведомлена.
- [ ] **DNS TTL основного домена снижен до 60 с** (≥48 ч до окна).

### 1.4 Уведомление пользователей
- [ ] За 1 неделю / 24 часа / 1 час — уведомления о плановом обслуживании.

### 1.5 Pre-flight (непосредственно перед открытием окна)
- [ ] `bash scripts/cutover/01-preflight.sh` → **зелёный** (CI, schema-drift Supabase vs `schema.sql`,
      Yandex PG + latency, Cloud.ru S3 + manifest, delta-replay тесты, отчёт Iteration 9, контакты).
      Любой провал → «Cutover откладывается», окно НЕ открывается (ADR-0005 «Условия отмены»).

---

## 2. Cutover-окно — таймлайн (цель ~95 мин; RTO 2–4 ч, [ADR-0005](adr/0005-rpo-rto.md))

Вести live-таймлайн ([timeline-template.md](cutover-artifacts/timeline-template.md)). Каждый скрипт пишет
лог в `/var/log/cutover/`. RPO=0 (read-only с T0+00 до dump).

| План | Шаг | Команда | Контроль |
|---|---|---|---|
| **T0+00** | 1. Уведомление + maintenance-ON старого прода | `bash scripts/cutover/02-maintenance-on-old.sh` | POST `/api`→503, GET→200, маркер `X-BillHub-Maintenance` |
| **T0+05** | 2. pg_dump Supabase (read-only) | `bash scripts/cutover/03-pg-dump-supabase.sh` | размер дампа в таймлайн |
| **T0+15** | 3. pg_restore Yandex -j4 + schema sanity | `bash scripts/cutover/04-pg-restore-yandex.sh` | набор таблиц = `schema.sql` + ожидаемые новые; counts сошлись |
| **T0+35** | 4. import-passwords | `bash scripts/cutover/05-import-passwords.sh` | verify-sample 100/100 (иначе → rollback A) |
| **T0+40** | 5. rclone sync --update дельта | `bash scripts/cutover/06-rclone-sync-delta.sh` | дельта применена |
| **T0+50** | 6. verify-s3 (size-only + manifest) | `bash scripts/cutover/07-verify-s3.sh` | 0 расхождений; manifest ±0.1% |
| **T0+55** | 7. production startup checks новая VPS | `bash scripts/cutover/08-startup-checks-new.sh` | `/health/ready`=200 (PG/migrations/redis/S3 ok) |
| **T0+60** | 8. smoke temp-домен (Playwright) | `bash scripts/cutover/09-smoke-temp-domain.sh` | зелёный; иначе → rollback A |
| **T0+75** | === ТОЧКА НЕВОЗВРАТА === | заполнить [decision-checklist.md](cutover-artifacts/decision-checklist.md) | решение incident-команды |
| **T0+76** | 9. DNS cutover (ручная) | [10-dns-switch-checklist.md](../scripts/cutover/10-dns-switch-checklist.md) | зафиксировать `T_dns_switch`; propagation TTL 60с |
| **T0+85** | 10. smoke production (основной домен) | `bash scripts/cutover/11-smoke-production.sh` | зелёный; иначе → rollback B / fix-forward |
| **T0+95** | 11. maintenance-OFF новой VPS (go-live) | `bash scripts/cutover/12-maintenance-off.sh` | live, маркера нет |
| **T0+95** | 12. Объявить успешное завершение | — | уведомить пользователей |

**Буфер:** ~95 мин целевое → 30+ мин до RTO 2 ч, 60+ мин до заявленных 4 ч (worst case ~3.5 ч, ADR-0005).

### Механизм maintenance (принцип 1 — без деплоя кода)
`02-maintenance-on-old.sh` подменяет nginx-конфиг фронтенда старого прода на
[`assets/nginx-maintenance.conf`](../scripts/cutover/assets/nginx-maintenance.conf) (write-методы `/api/`→503,
чтение работает) через `docker cp` + `nginx -s reload`; оригинал бэкапится для rollback. Это ЕДИНСТВЕННОЕ
изменение старого прода за всё время Этапа 1. Старый прод остаётся read-only ≥30 дней как fallback.

### Рубежи rollback
- **До DNS-switch** (шаги ≤8) → [Сценарий A](runbook-rollback.md#сценарий-a--до-dns-switch):
  `bash scripts/cutover/rollback-scenario-a.sh` (старый прод → read-write; DNS не тронут).
- **После DNS-switch** (шаг 10+) → [Сценарий B](runbook-rollback.md#сценарий-b--сразу-после-dns-switch):
  `bash scripts/cutover/rollback-scenario-b.sh` (revert DNS + delta-replay записей после `T_dns_switch`).

---

## 3. Post-cutover

### Первые 24 часа — `scripts/post-cutover/24h-monitoring.sh`
Планировать каждые 30 мин (cron/systemd-timer; либо `LOOP=1`). Пороги = мониторы Iteration 7:

| Проверка | Порог (ALERT при) | Источник |
|---|---|---|
| uptime | `/health/live` или `/health/ready` != 200 | external uptime + скрипт |
| DB connections | > 80% `conn_limit` (> 24 из 30) | `pg_stat_activity` |
| dead jobs | > 0 за последний час | `jobs_log` |
| monitor-алерты | `audit_log`: `db_connections_high`/`dead_jobs_detected`/`s3_error_rate_high` за час > 0 | `audit_log` |
| error_logs | > порога за окно (по умолч. 50/30 мин) | `error_logs` |
| retention | партиция `audit_log` текущего месяца отсутствует | `pg_tables` |

Любой ALERT → exit !=0 → уведомление получателям (канал инцидента / Telegram / email — [§10 инвентаря](migration-inventory.md)).
Реакция — [runbook-incident-response.md](runbook-incident-response.md).

### Первая неделя — `scripts/post-cutover/week-1-report.sh`
Ежедневный/итоговый read-only отчёт (audit_log по событиям, jobs_log, error_logs, соединения, партиции,
outbox backlog) → [cutover-artifacts/week-1-report.md](cutover-artifacts/week-1-report.md). Один
backup-restore rehearsal; сравнение производительности OCR с pre-cutover.

### 30 дней стабильности
- [ ] Post-mortem (включая отклонения от таймлайна).
- [ ] Решение об отключении старой инфры: Cloudflare R2 → архив/удаление; Supabase → отключение; старая VPS → гасится.

---

## 4. Связанные документы

- ADR: [0001](adr/0001-deviations-from-corp-standard.md) · [0002](adr/0002-sql-first-drizzle.md) ·
  [0003](adr/0003-cutover-db-strategy.md) · [0004](adr/0004-cutover-files-strategy.md) ·
  [0005](adr/0005-rpo-rto.md) · [0006](adr/0006-rollback-procedure.md)
- [migration-inventory.md](migration-inventory.md) · [cutover-tests.md](cutover-tests.md) ·
  [cutover-rehearsal-plan.md](cutover-rehearsal-plan.md) · [runbook-rollback.md](runbook-rollback.md) ·
  [runbook-incident-response.md](runbook-incident-response.md) · [runbook-vps-migration.md](runbook-vps-migration.md)
- Артефакты окна: [cutover-artifacts/](cutover-artifacts/) (timeline, decision-checklist, манифесты, логи, отчёты).
