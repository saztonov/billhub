# Decision-checklist — ТОЧКА НЕВОЗВРАТА (T0+75, перед DNS-switch)

Заполняется **incident-командой** на шаге 10 (перед `10-dns-switch-checklist.md`). Это рубеж между
дешёвым rollback (Сценарий A — DNS не тронут) и дорогим (Сценарий B — revert DNS + delta-replay,
[ADR-0006](../adr/0006-rollback-procedure.md)). Переключать DNS **только если все критерии ✓**.

**Дата/время (UTC):** ______________  **Ведёт:** ______________  **Канал:** ______________

## Критерии (все должны быть ✓)

- [ ] **Smoke на temp-домене зелёный** — `09-smoke-temp-domain.sh` exit 0; логин под 4 ролями
      прежними паролями; создание заявки, загрузка файла, OCR, согласование, СБ-флоу прошли.
- [ ] **Schema sanity зелёный** — `04-pg-restore-yandex.sh`: набор таблиц = `schema.sql` + ТОЛЬКО
      ожидаемые новые (`refresh_tokens`, `password_reset_tokens`, `outbox`, `jobs_log`, `audit_log*`).
- [ ] **Counts сошлись** — count(users/payment_requests/contract_requests) Yandex == Supabase.
- [ ] **import-passwords 100/100** — `05-import-passwords.sh` verify-sample прошёл.
- [ ] **Файлы сверены** — `07-verify-s3.sh`: `rclone check --size-only` 0 расхождений; manifest ±0.1%.
- [ ] **Production startup checks PASS** — `08-startup-checks-new.sh`: `/health/ready=200`, все
      зависимости ok (PG, migrations==expected, Redis, S3).
- [ ] **Нет 5xx / ошибок в логах новой VPS** — error_logs/pino без всплеска за время smoke.
- [ ] **Performance приемлем** — отклик smoke в норме (нет деградации p95).
- [ ] **Откат подготовлен** — `T_dns_switch` будет зафиксирован; `rollback-scenario-b.sh` и
      `delta-replay` готовы; старый прод в read-only (fallback).
- [ ] **Команда на связи** — DBA, DevOps, backend/frontend lead, communications доступны.

## Решение

- [ ] **ПРИНИМАЕМ cutover** — переходим к шагу 10 (DNS-switch). Подпись: ______________
- [ ] **ОТМЕНЯЕМ / ОТКЛАДЫВАЕМ** — rollback Сценарий A (`rollback-scenario-a.sh`), DNS не трогаем.
      Причина: ________________________________________. Подпись: ______________

> Любой НЕ-✓ критерий по умолчанию означает ОТМЕНУ, если incident-команда явно не приняла риск
> (зафиксировать обоснование в строке «Причина» live-таймлайна).
