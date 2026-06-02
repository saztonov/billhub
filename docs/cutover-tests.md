# Cutover tests — матрица и Definition of Done (Iteration 9)

Полная схема функциональных, интеграционных, нагрузочных и security-тестов на **копии prod-данных**
перед Cutover 1 (план Iteration 9). Cutover выполняется ТОЛЬКО после того, как все галочки в
разделе [Definition of Done](#definition-of-done) зелёные (принцип 4).

## Среда

- Новая VPS + Yandex Managed PostgreSQL + Cloud.ru S3, развёрнуты в Iteration 8.
- БД наполнена копией prod-данных через [`scripts/dump-and-restore.sh`](../scripts/dump-and-restore.sh)
  (ADR-0003, полный `pg_dump --data-only` + `pg_restore`, НЕ инкрементальный).
- Файлы перенесены R2 → Cloud.ru через [`scripts/sync-r2-to-cloudru.sh`](../scripts/sync-r2-to-cloudru.sh)
  (ADR-0004, manifest-based, `rclone --size-only`).
- **Реальные ПДн** в копии → среда закрыта **basic-auth + IP-allowlist** на временном домене;
  доступ только команде разработки. Старый прод НЕ модифицируется (принцип 1).
- Backend: `DB_PROVIDER=drizzle`, `AUTH_MODE=standalone`, `STORAGE_PROVIDER=cloudru`, `NODE_ENV=production`.
- Ресурсы: 2 CPU / 4 GB (API + worker делят 2 vCPU) — под это скорректированы SLO.

## Как запускать

```bash
# 0. Наполнение копией данных + verification (count + schema-diff) + import-passwords
SUPABASE_DB_URL=... DATABASE_MIGRATION_URL=... bash scripts/dump-and-restore.sh

# 1. Миграция файлов R2 → Cloud.ru + verification
SIDE=r2 bash scripts/list-r2-manifest.sh                 # → docs/cutover-artifacts/manifest_r2_T1.json
bash scripts/sync-r2-to-cloudru.sh                       # rclone copy
bash scripts/verify-s3-sync.sh                           # rclone check --size-only
SIDE=cloudru bash scripts/list-r2-manifest.sh            # → manifest_cloudru_T1.json
npx tsx scripts/compare-s3-manifests.ts                  # count/total_size ±0.1%
SAMPLE_SIZE=50 npx tsx scripts/audit-s3-sample.ts        # byte-range 50/50

# 2. Функциональные + критические + security (Playwright)
SMOKE_BASE_URL=https://<temp> npx playwright test e2e/role-based e2e/critical e2e/security

# 3. Нагрузочные (k6)
SMOKE_BASE_URL=https://<temp> k6 run e2e/load/normal-day.js
SMOKE_BASE_URL=https://<temp> k6 run e2e/load/peak-morning.js
E2E_OCR_REQUEST_IDS=... k6 run e2e/load/mass-ocr.js
E2E_CP_NAME="<Контрагент>" k6 run e2e/load/parallel-upload.js

# 4. Backup-restore rehearsal Yandex PG (в отдельный тестовый кластер)
SOURCE_CLUSTER_ID=... RESTORE_NETWORK_ID=... RESTORE_SUBNET_ID=... bash scripts/backup-restore-rehearsal.sh

# 5. delta-replay unit-тесты (rollback-инструмент, ADR-0006)
npm --prefix server test -- src/cli/delta-replay-yandex-to-supabase.test.ts
```

> ENV-параметры тестов (учётки по ролям, имя контрагента, id заявок для race) — см.
> [`e2e/helpers/config.ts`](../e2e/helpers/config.ts). По умолчанию — синтетика smoke-стенда;
> для копии prod-данных задаются реальные учётки.

---

## Матрица: role-based функциональные

| Файл | Роль | Сценарии | DoD |
|---|---|---|---|
| [counterparty_user.spec.ts](../e2e/role-based/counterparty_user.spec.ts) | counterparty_user | логин прежним паролем; заявка на оплату (PDF+xlsx); заявка на договор (учредительные); редактирование шапки; реакция на доработку; реакция на отклонение; чат+счётчик; смена пароля | все 8 тестов зелёные |
| [user.spec.ts](../e2e/role-based/user.spec.ts) | user (сотрудник) | логин; фильтр по подразделению (omts/shtab/smetny); approve / reject c причиной / на доработку / откат; назначение исполнителя; РП в DpFillModal; материалы; импорт/экспорт ExcelJS | все 9 тестов зелёные |
| [admin.spec.ts](../e2e/role-based/admin.spec.ts) | admin | полный доступ; справочники; конструктор цепочек; OCR-модели; ErrorLogs; импорт пользователей из Excel; закрытие доработки за Штаб/Подрядчика; изменение суммы с обязательной причиной | все 8 тестов зелёные |
| [security.spec.ts](../e2e/role-based/security.spec.ts) | security (СБ) | логин → только `/references/suppliers`; запрос проверки; решение approved/rejected с комментарием; невидимость прочих разделов; блокировка договора с rejected-поставщиком; история проверок | все 6 тестов зелёные |

## Матрица: критические интеграционные

| Файл | Сценарий | DoD |
|---|---|---|
| [chunked-upload.spec.ts](../e2e/critical/chunked-upload.spec.ts) | 90 МБ через Redis-session, обрыв на 50%, resume, complete | объект собран; status показывает частичную загрузку до resume |
| [ocr-full-cycle.spec.ts](../e2e/critical/ocr-full-cycle.spec.ts) | PDF → BullMQ → ocrWorker → mock OpenRouter → спецификация → SSE → UI | спецификация появилась; SSE без ошибок |
| [parallel-workload.spec.ts](../e2e/critical/parallel-workload.spec.ts) | 10 одновр. presign; 5 одновр. approve; race 2×decide по одной заявке | ровно 1 успех в race; ключи уникальны; нет 5xx |
| [refresh-rotation.spec.ts](../e2e/critical/refresh-rotation.spec.ts) | 5 одновр. refresh в grace-window → все 200; replay >6 с → 401 + family инвалидирована | grace работает; reuse-replay = 401 |
| [password-reset.spec.ts](../e2e/critical/password-reset.spec.ts) | request → plain-токен в API-ответе админа → confirm → старый пароль 401, новый 200 | цикл зелёный; tokenId ≠ resetToken |

## Матрица: нагрузочные (k6) — SLO под 2 CPU / 4 GB

| Файл | Профиль | SLO |
|---|---|---|
| [normal-day.js](../e2e/load/normal-day.js) | 50 VU × 30 мин, 70/20/10 read/write/upload | **p95 < 1000 мс**, error < 0.5%, PG pool < 80% (24/30, out-of-band) |
| [peak-morning.js](../e2e/load/peak-morning.js) | ramp→100 за 5 мин, удержание 15 мин, 30% upload | **p95 < 2000 мс**, 5xx = 0, dead jobs = 0 |
| [mass-ocr.js](../e2e/load/mass-ocr.js) | 50 OCR-задач, OCR_CONCURRENCY=3 | разгребается за ~80–100 мин; watchdog подбирает зависшие; потерь нет; dead = 0 |
| [parallel-upload.js](../e2e/load/parallel-upload.js) | 20 VU × 50 МБ chunked | все 20 завершены; uploadSemaphore ограничивает; S3 без throttle (0×5xx) |

> **PG pool** и **dead jobs** k6 не измеряет напрямую — проверяются out-of-band мониторами
> Iteration 7: `SELECT count(*) FROM pg_stat_activity WHERE usename='billhub_runtime'` (< 24) и
> `SELECT count(*) FROM jobs_log WHERE status='dead' AND created_at > now()-interval '1 hour'` (= 0).

## Матрица: security

| Файл | Проверка | DoD |
|---|---|---|
| [access-control.spec.ts](../e2e/security/access-control.spec.ts) | JWT чужой aud/невалидный → 401; чужой файл → 403; SQL-injection → не 500, БД цела; rate-limit 6-я попытка → 429 | все 4 теста зелёные |
| [log-leaks.spec.ts](../e2e/security/log-leaks.spec.ts) | grep-snapshot error_logs + /api/ocr/logs + pino-файл: 0 plain-паролей / reset-токена / refresh / presigned-подписей / JWT; OCR-поля редактированы | 0 совпадений needle |

---

## Definition of Done

Cutover разрешён, когда ВСЕ пункты зелёные (Gate Iteration 9):

- [ ] Все role-based сценарии зелёные на всех 4 ролях (counterparty_user 8 / user 9 / admin 8 / security 6).
- [ ] Все критические интеграционные зелёные (chunked-upload, OCR full cycle, parallel workload, refresh rotation, password reset).
- [ ] Нагрузочный normal-day: **p95 < 1000 мс**, error rate **< 0.5%**, PG pool **< 80%** (24/30).
- [ ] Нагрузочный peak-morning: **p95 < 2000 мс**, **5xx = 0**, **dead jobs = 0**.
- [ ] Нагрузочный mass-ocr: 50 задач разгребаются (~80–100 мин), watchdog подбирает зависшие, потерь нет.
- [ ] Нагрузочный parallel-upload: 20×50 МБ загружены, `uploadSemaphore` ограничивает, S3 без throttle.
- [ ] Security: JWT aud → 401, чужая заявка → 403 (+audit), SQL-injection отбита, rate-limit 429.
- [ ] Grep-snapshot по логам: **0 утечек** plain-значений (включая OCR-фрагменты `recognized_text`/`material_name`/`ocr_response`).
- [ ] Production startup checks PASS на новой VPS с подгруженной копией данных.
- [ ] `rclone check --size-only` R2 vs Cloud.ru: **0 расхождений**.
- [ ] Manifest verification: count и total_size с допуском **±0.1%**.
- [ ] Byte-range audit: **50/50** ключей зелёные.
- [ ] `pg_dump --schema-only` после restore + 0001/0002 = `schema.sql` + ожидаемые новые таблицы
      (`refresh_tokens`, `password_reset_tokens`, `outbox`, `audit_log*`, `jobs_log`); иных расхождений нет.
- [ ] Backup-restore rehearsal зелёный ([`backup-restore-rehearsal.sh`](../scripts/backup-restore-rehearsal.sh)).
- [ ] import-passwords на **100** случайных пользователях: **100/100** (`--verify-sample 100`).
- [ ] `delta-replay-yandex-to-supabase.ts` unit-тесты зелёные (success / conflict / timeout / partial-batch / retry).

## Связанные документы

- [ADR-0003](adr/0003-cutover-db-strategy.md) — стратегия cutover БД (pg_dump/restore).
- [ADR-0004](adr/0004-cutover-files-strategy.md) — стратегия миграции файлов (manifest-based, size-only).
- [ADR-0005](adr/0005-rpo-rto.md) — RPO/RTO.
- [ADR-0006](adr/0006-rollback-procedure.md) — rollback (delta-replay).
- [migration-cutover.md](migration-cutover.md) — runbook окна cutover (Iteration 10).
- [migration-inventory.md](migration-inventory.md) — таблицы, ключи S3, connection budget, артефакты.
