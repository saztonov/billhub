# Отчёт Iteration 9 — полная схема тестов на копии prod-данных (ШАБЛОН)

Прогон полной схемы тестов Iteration 9 на новой инфре (копия prod-данных) — фиксируется этим отчётом
**за 1–2 недели до cutover** и повторяется непосредственно перед окном. `01-preflight.sh` (проверка 8)
требует, чтобы этот файл существовал и содержал строку **`ИТОГ: PASS`** — иначе cutover откладывается.

Матрица и Definition of Done — см. [docs/cutover-tests.md](../cutover-tests.md).

- **Дата прогона:** ______________  **Среда (temp-домен/стенд):** ______________  **Прогон вёл:** ______________
- **Версия (git sha main):** ______________

## Результаты (заполнить по факту прогона)

| Блок | Критерий | Результат |
|---|---|---|
| role-based counterparty_user | 8/8 | ☐ |
| role-based user | 9/9 | ☐ |
| role-based admin | 8/8 | ☐ |
| role-based security | 6/6 | ☐ |
| critical: chunked-upload 90 МБ + resume | pass | ☐ |
| critical: OCR full cycle | pass | ☐ |
| critical: parallel workload (race) | pass | ☐ |
| critical: refresh rotation + grace + reuse | pass | ☐ |
| critical: password reset (токен не в audit_log) | pass | ☐ |
| load: normal-day | p95<1000мс, err<0.5%, PG pool<24 | ☐ |
| load: peak-morning | p95<2000мс, 5xx=0, dead=0 | ☐ |
| load: mass-ocr | разгребается ~80–100 мин, dead=0 | ☐ |
| load: parallel-upload | 20×50МБ, без throttle | ☐ |
| security: access-control | JWT aud→401, чужой файл→403, SQLi отбита, rate-limit 429 | ☐ |
| security: log-leaks (grep-snapshot) | 0 утечек (вкл. OCR-поля) | ☐ |
| rclone check --size-only | 0 расхождений | ☐ |
| manifest verify | count/total ±0.1% | ☐ |
| byte-range audit | 50/50 | ☐ |
| schema diff после restore | = schema.sql + ожидаемые новые | ☐ |
| backup-restore rehearsal | зелёный | ☐ |
| import-passwords | 100/100 | ☐ |
| delta-replay unit-тесты | зелёные | ☐ |

## Артефакты прогона

- Playwright HTML report: ______________
- k6 summary (4 профиля): ______________
- rclone_check / manifest сравнение: см. `docs/cutover-artifacts/`
- backup-restore rehearsal лог: ______________

## Итог

После полного зелёного прогона замените заполнитель в строке ниже на `PASS`; при наличии красных —
на `FAIL`. Строка должна начинаться с начала строки — её проверяет `scripts/cutover/01-preflight.sh`
(проверка 8: ищет `ИТОГ: PASS` с начала строки).

ИТОГ: не заполнено

```
(блокеры/отклонения, если вердикт FAIL)
```
