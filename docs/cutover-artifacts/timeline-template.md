# Cutover 1 — live-таймлайн (шаблон, заполняется в окне)

Скопируйте этот файл в `cutover_timeline.md` и заполняйте фактические метки в окне cutover.
Целевое окно ~95 мин (буфер до RTO 2 ч / заявленных 4 ч — [ADR-0005](../adr/0005-rpo-rto.md)).

- **Дата cutover:** ______________________
- **Cutover owner:** ______________________
- **Канал инцидента:** ______________________
- **T0 (UTC):** ______________________

| План | Шаг | Скрипт | Факт (UTC) | Δ | Статус / заметки |
|---|---|---|---|---|---|
| T0+00 | 1. Pre-flight (вне окна, до T0) | `01-preflight.sh` | | | ☐ зелёный |
| T0+00 | 2. Уведомление + maintenance-ON старый прод | `02-maintenance-on-old.sh` | | | ☐ read-only подтверждён (POST=503) |
| T0+05 | 3. pg_dump Supabase | `03-pg-dump-supabase.sh` | | | размер дампа: ______ |
| T0+15 | 4. pg_restore Yandex -j4 + schema sanity | `04-pg-restore-yandex.sh` | | | ☐ sanity = ожидаемые таблицы; counts: ______ |
| T0+35 | 5. import-passwords | `05-import-passwords.sh` | | | verify-sample 100/100: ☐ |
| T0+40 | 6. rclone sync --update дельта | `06-rclone-sync-delta.sh` | | | новых объектов: ______ |
| T0+50 | 7. rclone check --size-only + manifest | `07-verify-s3.sh` | | | ☐ 0 расхождений; manifest ±0.1% ☐ |
| T0+55 | 8. production startup checks новая VPS | `08-startup-checks-new.sh` | | | ☐ /health/ready=200 (PG/migr/redis/S3) |
| T0+60 | 9. smoke temp-домен (Playwright) | `09-smoke-temp-domain.sh` | | | ☐ зелёный (логин 4 роли + флоу) |
| T0+75 | === ТОЧКА НЕВОЗВРАТА === decision-checklist | — | | | решение: ПРИНИМАЕМ ☐ / ОТМЕНА ☐ |
| T0+76 | 10. DNS cutover (ручная) | `10-dns-switch-checklist.md` | | | **T_dns_switch (UTC): ______** |
| T0+85 | 11. smoke production (основной домен) | `11-smoke-production.sh` | | | ☐ зелёный |
| T0+95 | 12. maintenance-OFF новая VPS (go-live) | `12-maintenance-off.sh` | | | ☐ live, маркера нет |
| T0+95 | Объявить успешное завершение | — | | | ☐ уведомление пользователям |

## Контрольные значения (для сверки)

- count(users) Supabase: ______ → Yandex: ______
- count(payment_requests) Supabase: ______ → Yandex: ______
- count(contract_requests) Supabase: ______ → Yandex: ______
- объектов S3 R2: ______ → Cloud.ru: ______ (Δ ≤ ±0.1%)

## Отклонения от плана / инциденты в окне

```
(записывать здесь любые отклонения, ошибки, принятые решения)
```

## Исход

- [ ] Cutover завершён успешно в ______ (UTC). Окно: ______ мин (цель ~95, RTO 2–4 ч).
- [ ] ИЛИ rollback Сценарий ____ инициирован в ______; причина: ____________________.
