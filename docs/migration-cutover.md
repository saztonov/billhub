# Cutover 1 Runbook — Supabase + R2 → Yandex PG + Cloud.ru S3

Пошаговый runbook для cutover-окна Этапа 1 (итерация 10 в плане). Этот документ — операционный плейбук на день cutover.

**Архитектурные решения:** см. [docs/adr/](adr/).
**Инвентаризация:** см. [docs/migration-inventory.md](migration-inventory.md).
**Rollback:** см. [docs/adr/0006-rollback-procedure.md](adr/0006-rollback-procedure.md).

---

## 1. Pre-cutover (за 1–2 недели до окна, в рамках итераций 9 и 10)

### 1.1 Готовность кодовой базы

- [ ] Все итерации Этапа 1 cutover-critical track (Iteration 0 + 1–9) завершены и слиты в `main`.
- [ ] CI на `main` зелёный (lint + tsc + tests + build).
- [ ] Coverage backend ≥ 70%, frontend ≥ 50%.
- [ ] `npm audit --omit=dev` без high/critical.
- [ ] Drizzle `introspect`-drift проверка зелёная.
- [ ] Production startup checks падают при placeholder-значениях.

### 1.2 Готовность инфраструктуры

- [ ] Новая VPS работает; backend на `temp.billhub.ru` отвечает 200 на `/health/ready`.
- [ ] Yandex Managed PG развёрнут (master + sync replica); расширения включены; пользователи созданы; conn_limit задан (см. [migration-inventory.md §5](migration-inventory.md)); бэкапы + PITR включены; latency от новой VPS ≤ 30 мс на простом SELECT.
- [ ] Cloud.ru S3 bucket создан; allowlist на статический IP новой VPS работает; backend на VPS успешно делает HEAD bucket.
- [ ] Cloudflare R2 → Cloud.ru S3 первичный `rclone copy` завершён; `rclone check --size-only` 0 расхождений; byte-range audit 50 объектов зелёный; manifest сохранён.
- [ ] `import-passwords.ts` проверен на 100 случайных пользователях (логин старым паролем).
- [ ] Backup-restore Yandex PG в тестовый кластер прорепетирован.
- [ ] `delta-replay-yandex-to-supabase.ts` реализован и покрыт unit-тестами.

### 1.3 Готовность процедуры

- [ ] Этот runbook прочитан всей cutover-командой.
- [ ] [ADR-0006](adr/0006-rollback-procedure.md) (rollback) прорепетирован на staging для Сценария A и B.
- [ ] Все контакты в [migration-inventory.md §10](migration-inventory.md) заполнены.
- [ ] Slack/Telegram-канал инцидента создан.
- [ ] **DNS TTL основного домена снижен до 60 с** (минимум за 48 часов до окна).

### 1.4 Уведомление пользователей

- [ ] За 1 неделю — email/уведомление в портале о плановом обслуживании.
- [ ] За 24 часа — напоминание.
- [ ] За 1 час до окна — финальное напоминание.

---

## 2. Cutover-окно (T0 — T0 + 2..4ч)

### T0 — Старт окна

- [ ] **T0** — Объявить начало окна в Slack/Telegram-канале инцидента.
- [ ] **T0 + 5 мин** — Перевести старую VPS в **read-only**:
  - nginx serves maintenance page на `https://billhub.ru/maintenance`.
  - Backend отклоняет POST/PUT/DELETE/PATCH с 503 + JSON `{error: "maintenance"}`.
  - Скрипт перевода: `ssh old-vps "docker compose exec backend node /app/cli/enter-maintenance.js"`.

### Шаг 1: Snapshot Supabase (~5–15 мин)

- [ ] Запустить `pg_dump`:
  ```bash
  PGPASSWORD="$SUPABASE_DB_PASSWORD" pg_dump \
    -h "db.${SUPABASE_PROJECT_ID}.supabase.co" -U postgres -d postgres \
    --data-only --no-owner --no-privileges \
    --schema=public --schema=auth \
    --exclude-table-data='auth.audit_log_entries' \
    --exclude-table-data='auth.flow_state' \
    --exclude-table-data='auth.refresh_tokens' \
    -Fc \
    -f /artifacts/cutover_${T0_TIMESTAMP}.dump
  ```
- [ ] Проверить размер dump: `ls -lh /artifacts/cutover_*.dump`. Записать в timeline.

### Шаг 2: Restore в Yandex PG (~10–20 мин)

- [ ] Запустить `pg_restore`:
  ```bash
  PGPASSWORD="$YANDEX_BILLHUB_MIGRATION_PASSWORD" pg_restore \
    -h "$YANDEX_PG_HOST" -U billhub_migration -d billhub_db \
    --data-only --no-owner --no-privileges \
    -j 4 \
    --verbose \
    /artifacts/cutover_${T0_TIMESTAMP}.dump 2>&1 | tee /artifacts/pg_restore.log
  ```
- [ ] Проверить exit code = 0.
- [ ] Verification SQL (на Yandex PG):
  ```sql
  SELECT count(*) FROM users;
  SELECT count(*) FROM payment_requests;
  SELECT count(*) FROM contract_requests;
  SELECT count(*) FROM payment_request_files;
  ```
- [ ] Сравнить с числами из Supabase (записать в timeline).

### Шаг 3: Импорт паролей (~1–2 мин)

- [ ] Запустить:
  ```bash
  ssh new-vps "node /app/cli/import-passwords.js \
    --source-url '$SUPABASE_URL' \
    --source-key '$SUPABASE_SERVICE_ROLE_KEY' \
    --target-url '$YANDEX_DATABASE_URL' \
    --verify-sample 100"
  ```
- [ ] Скрипт сам проверяет на выборке 100 случайных пользователей, что `bcrypt.compare(testPassword, password_hash)` работает.
- [ ] Если verify-sample не прошёл → **немедленно Сценарий A rollback**.

### Шаг 4: Финальная дельта файлов (~2–10 мин)

- [ ] Запустить:
  ```bash
  rclone sync --update \
    r2:billhub-r2 cloudru:billhub-s3 \
    --transfers 16 --checkers 32 \
    --s3-chunk-size 16M \
    --log-file=/artifacts/rclone_cutover.log
  ```

### Шаг 5: Verification файлов (~2–5 мин)

- [ ] `rclone check --size-only r2:billhub-r2 cloudru:billhub-s3 > /artifacts/rclone_check.log`. Должно быть 0 differences.
- [ ] Manifest update:
  ```bash
  aws s3api list-objects-v2 \
    --endpoint-url "$CLOUDRU_ENDPOINT" \
    --bucket billhub-s3 \
    --query 'Contents[].{Key:Key, Size:Size}' \
    > /artifacts/manifest_cloudru_cutover.json
  node scripts/compare-s3-manifests.ts \
    /artifacts/manifest_r2_cutover.json \
    /artifacts/manifest_cloudru_cutover.json
  ```
- [ ] Если расхождения → разобраться (типично — pending uploads на стороне старого backend, который уже в read-only; не должно быть).

### Шаг 6: Production startup checks (~1–2 мин)

- [ ] На новой VPS поднять backend с production env:
  ```bash
  ssh new-vps "cd /opt/portals/billhub && docker compose up -d backend worker"
  ```
- [ ] Дождаться `/health/ready` 200 (timeout 60 с).
- [ ] Проверить, что startup logs показывают:
  - `DB_PROVIDER=drizzle` принят.
  - Drizzle migrations: last applied == expected.
  - S3 reachable.
  - Redis ping ok.
  - JWKS — N/A для standalone, OK.

### Шаг 7: Smoke на временном домене (~10–15 мин)

- [ ] Запустить Playwright smoke против `https://temp.billhub.ru`:
  ```bash
  npx playwright test --grep="@cutover-smoke" --reporter=html \
    --output=/artifacts/cutover_smoke_playwright
  ```
- [ ] Чек-лист smoke:
  - [ ] Логин под admin прежним паролем.
  - [ ] Логин под user прежним паролем.
  - [ ] Логин под counterparty_user прежним паролем.
  - [ ] Логин под security прежним паролем.
  - [ ] Создание тестовой заявки + загрузка файла (3 МБ PDF).
  - [ ] Файл скачивается обратно.
  - [ ] OCR-задача обрабатывается (мок OpenRouter в тесте).
  - [ ] Согласование РП — переход на следующий статус.
  - [ ] СБ-флоу: запрос проверки → решение → блокировка по rejected.
- [ ] Если smoke провалился → **Сценарий A rollback** (DNS ещё не переключён).

### Шаг 8: DNS cutover (~1–5 мин)

- [ ] **ТОЧКА НЕВОЗВРАТА (рубеж между Сценарием A и B).** Сверка с incident-командой: все ли smoke зелёные? Согласие на switch.
- [ ] Обновить DNS A-запись `billhub.ru` на статический IP новой VPS.
- [ ] Засечь время T_dns_switch — ВАЖНО для возможного delta-replay при Сценарии B.
- [ ] Дождаться propagation (TTL 60 с + Yandex DNS cache ≤ 1 мин).

### Шаг 9: Smoke в production (~5–10 мин)

- [ ] Через VPN или из разных регионов проверить, что `https://billhub.ru` теперь резолвится на новую VPS.
- [ ] Повторить тот же чек-лист smoke, но через основной домен.
- [ ] Проверить, что Sentry/error_logs не наполняются ошибками.
- [ ] Проверить, что новые операции корректно пишутся в Yandex PG (например, тестовый INSERT через UI и SELECT в SQL клиенте).
- [ ] Если что-то идёт не так и быстрый fix-forward невозможен → **Сценарий B rollback** (DNS-возврат + delta-replay).

### Шаг 10: Снятие maintenance (~1 мин)

- [ ] Снять maintenance-страницу на новой VPS (она была включена в шаге 6 для защиты).
- [ ] Объявить в Slack/Telegram-канале: «cutover завершён успешно».
- [ ] Отправить уведомление пользователям.

---

## 3. Post-cutover (T0 + 4ч — T0 + 30 дней)

### Первые 24 часа

- [ ] Каждые 30 мин — проверка алертов (uptime, DB connections, dead jobs, S3 errors).
- [ ] Каждые 60 мин — сверка счётчиков ключевых таблиц с ожидаемым ростом (по тренду).
- [ ] При любом всплеске 5xx > 1% — incident-команда на связи; решение fix-forward vs rollback.
- [ ] Логи новой VPS перечитать на предмет неожиданных warning/error (grep по `level=error`).

### Первая неделя

- [ ] Ежедневный отчёт incident-команды.
- [ ] Backup-restore rehearsal Yandex PG в тестовый кластер один раз.
- [ ] Мониторинг производительности OCR (latency, throughput) — сравнить с pre-cutover.

### 30 дней стабильности

- [ ] Опубликовать post-mortem (включая отклонения от планируемого таймлайна).
- [ ] Принять решение об отключении старой инфры:
  - Cloudflare R2 → перевести в архивное хранение или удалить (через 30 дней read-only).
  - Supabase Cloud → отключить (через 30 дней read-only).
  - Старая VPS → погасить или переиспользовать.

---

## 4. Timeline шаблон (заполняется live)

```
T0     | Старт окна, перевод в read-only
T0+05  | pg_dump запущен
T0+__  | pg_dump готов (size: ___ MB)
T0+__  | pg_restore запущен
T0+__  | pg_restore завершён, verification passed
T0+__  | import-passwords запущен
T0+__  | import-passwords готов (verify-sample 100/100 passed)
T0+__  | rclone sync дельты запущен
T0+__  | rclone sync завершён, check 0 differences
T0+__  | Production startup checks passed
T0+__  | Smoke на temp.billhub.ru passed
T0+__  | === ТОЧКА НЕВОЗВРАТА ===
T0+__  | DNS switch выполнен
T0+__  | Smoke на billhub.ru passed
T0+__  | Maintenance снята
T0+__  | Cutover завершён успешно
```

---

## 5. Связанные документы

- [docs/adr/0001-deviations-from-corp-standard.md](adr/0001-deviations-from-corp-standard.md)
- [docs/adr/0002-sql-first-drizzle.md](adr/0002-sql-first-drizzle.md)
- [docs/adr/0003-cutover-db-strategy.md](adr/0003-cutover-db-strategy.md)
- [docs/adr/0004-cutover-files-strategy.md](adr/0004-cutover-files-strategy.md)
- [docs/adr/0005-rpo-rto.md](adr/0005-rpo-rto.md)
- [docs/adr/0006-rollback-procedure.md](adr/0006-rollback-procedure.md)
- [docs/migration-inventory.md](migration-inventory.md)
- [docs/runbook-vps-migration.md](runbook-vps-migration.md)
