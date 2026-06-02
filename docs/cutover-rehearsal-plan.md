# Cutover 1 — план репетиции на staging

Репетиция полного cutover-окна и rollback-сценариев A/B **до** реального cutover (план Iteration 10;
[ADR-0006](adr/0006-rollback-procedure.md) §«Pre-cutover требования»). Цель — пройти все 12 шагов и
оба rollback-сценария на staging/копии, измерить фактическое время (сверка с RTO 2–4 ч, цель ~95 мин),
выявить расхождения скриптов с реальной средой до боевого окна.

## Что уже проверено AI (без staging-инфры)

- `shellcheck -x` всех 13 bash-скриптов cutover + 2 post-cutover + 2 lib — **PASS** (0 замечаний).
- **Idempotency dry-run**: каждый скрипт запущен дважды с `DRY_RUN=1` — идентичный вывод и код выхода,
  нулевые побочные эффекты (внешние пробы/команды печатаются, не выполняются).
- `01-preflight.sh` корректно откладывает cutover при ненайденном отчёте Iteration 9 / незаполненных
  контактах / schema-drift (проверено на dry-run, exit 1 с «Cutover откладывается»).

Это покрывает логику и идемпотентность скриптов. Сетевые операции (SSH-swap nginx, pg_dump/restore,
rclone, Playwright, DNS) репетируются на staging оператором по плану ниже.

## Состав staging для репетиции

- Staging-копия новой VPS (docker-compose.production.yml) + Yandex PG (тестовый кластер) + Cloud.ru S3
  (тестовый бакет) + копия файлов. Идеально — отдельный поддомен `stg.billhub.<домен>` с управляемым DNS.
- «Старый прод» эмулируется staging-инстансом со старым стеком (frontend nginx + backend), чтобы
  репетировать maintenance-swap и rollback.
- Реальные ПДн НЕ использовать вне защищённого периметра (basic-auth + IP-allowlist).

## Прогон A: полный happy-path (все 12 шагов)

Прогнать по `docs/migration-cutover.md`, фиксируя время каждого шага в копии
[timeline-template.md](cutover-artifacts/timeline-template.md):

1. `01-preflight.sh` (с реальными staging-URL) → зелёный.
2. `02-maintenance-on-old.sh` → старый-стейдж в read-only; проверить POST=503, GET=200.
3. `03-pg-dump-supabase.sh` (источник — staging-Supabase/копия).
4. `04-pg-restore-yandex.sh` → schema sanity зелёный, counts сошлись.
5. `05-import-passwords.sh` → verify-sample прошёл.
6. `06-rclone-sync-delta.sh` → дельта применена.
7. `07-verify-s3.sh` → 0 расхождений + manifest.
8. `08-startup-checks-new.sh` → `/health/ready=200`.
9. `09-smoke-temp-domain.sh` → зелёный.
10. Заполнить [decision-checklist.md](cutover-artifacts/decision-checklist.md) → DNS-switch на staging.
11. `11-smoke-production.sh` → зелёный.
12. `12-maintenance-off.sh` → go-live staging.

**Критерий A:** все шаги зелёные; суммарное время измерено и укладывается в RTO; live-таймлайн заполнен.

## Прогон B: rollback Сценарий A (до DNS-switch)

1. Шаги 1–8, затем **намеренно «сломать» smoke** (например, неверные креды/остановить worker).
2. `09-smoke-temp-domain.sh` → ожидаемый провал (exit !=0).
3. `rollback-scenario-a.sh` → старый-стейдж снова read-write (POST != 503), DNS не тронут.
4. Smoke на старом-стейдже зелёный.

**Критерий B:** возврат в read-write ≤10 мин; данных на новой инфре не появилось (RPO 0).

## Прогон C: rollback Сценарий B (после DNS-switch + delta-replay)

1. Полный happy-path до шага 10 (DNS-switch на staging), зафиксировать `T_DNS_SWITCH`.
2. Сгенерировать несколько write-операций на новой инфре (через UI/скрипт) ПОСЛЕ `T_DNS_SWITCH`.
3. **Намеренно «сломать»** production-smoke (шаг 11).
4. `rollback-scenario-b.sh` (с `DNS_REVERT_CMD` или `CONFIRM_DNS_REVERTED=1`):
   - DNS возвращён на старый-стейдж;
   - старый-стейдж read-write;
   - `delta-replay-yandex-to-supabase.ts` перенёс записи после `T_DNS_SWITCH` обратно в Supabase-копию.
5. Сверить счётчики: записи, созданные после switch, присутствуют в Supabase-копии; конфликтов нет
   (или разрешены вручную по `delta-replay-conflicts.log`).

**Критерий C:** delta-replay без потерь; RTO 15–30 мин; конфликты задокументированы.

## Если staging недоступен

Оператор проводит прогоны A/B/C на доступной среде и заполняет
[docs/cutover-rehearsal-report.md](cutover-rehearsal-report.md) (создаётся из шаблона ниже). Без зелёного
отчёта о репетиции rollback (Сценарии A и B) cutover не открывается ([ADR-0006](adr/0006-rollback-procedure.md)).

## Связанные документы

- [migration-cutover.md](migration-cutover.md) — боевой runbook окна.
- [runbook-rollback.md](runbook-rollback.md) — детальная процедура rollback.
- [ADR-0005](adr/0005-rpo-rto.md), [ADR-0006](adr/0006-rollback-procedure.md).
