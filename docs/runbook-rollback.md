# Runbook — процедура rollback Cutover 1 (детализация ADR-0006)

Операционная детализация [ADR-0006](adr/0006-rollback-procedure.md) с конкретными скриптами. Решение о
rollback принимает **incident-команда** (критерии — ниже и в [runbook-incident-response.md](runbook-incident-response.md)).

**Принцип 2:** runtime-fallback в Supabase ЗАПРЕЩЁН (split-brain). Rollback — явная операционная процедура.
**Fallback-окно:** старый прод (старая VPS + Supabase + Cloudflare R2) в read-only ≥30 дней.

## Выбор сценария

| Когда обнаружена проблема | Сценарий | Скрипт | RTO | RPO |
|---|---|---|---|---|
| До DNS-switch (шаг ≤9, smoke провален) | **A** | `rollback-scenario-a.sh` | 5–10 мин | 0 |
| Сразу после DNS-switch (минуты, шаг 11) | **B** | `rollback-scenario-b.sh` (+ delta-replay) | 15–30 мин | 0 при успешном replay |
| Через дни/недели | **C** | вручную + `delta-replay` на весь объём | часы | 0 при replay; конфликты — вручную |

## Критерии для rollback (любой из)

- Критичная функциональная регрессия, блокирующая бизнес (нельзя создать заявку/согласовать/OCR стоит).
- Утечка данных (ПДн в логах/Sentry; чужие файлы видны).
- p95 > 5 с в течение 30+ мин при нормальной нагрузке.
- «database unreachable» 30+ мин без видимой причины.

Не-критичные проблемы → **fix-forward** (rollback, особенно C, — крайняя мера).

---

## Сценарий A — до DNS-switch

**Контекст:** трафик ещё на старой VPS (read-only). На новой инфре write-операций НЕ было.

1. **НЕ переключать DNS.**
2. Запустить:
   ```bash
   OLD_VPS_SSH=deploy@old.<домен> OLD_BASE_URL=https://billhub.<домен> \
     bash scripts/cutover/rollback-scenario-a.sh
   ```
   Скрипт: восстанавливает прод-конфиг nginx старой VPS из бэкапа (снятого `02-maintenance-on-old.sh`),
   reload, verification (POST != 503 — запись снова работает). Идемпотентен.
3. Прогнать smoke на старой VPS (прежний боевой стек).
4. Сообщить пользователям: cutover отменён, портал работает на старой инфре.
5. Разобрать причину провала smoke на новой инфре, перепланировать cutover.

**Проверка:** `curl -I https://billhub.<домен>/` — маркера `X-BillHub-Maintenance` нет; POST к `/api/*`
возвращает не-503.

---

## Сценарий B — сразу после DNS-switch

**Контекст:** DNS уже на новой VPS; могли быть write-операции. Нужен delta-replay в Supabase.

**Предусловия:** известен `T_DNS_SWITCH` (зафиксирован на шаге 10); `delta-replay-yandex-to-supabase.ts`
протестирован (preflight проверка 7).

1. Подготовить переменные:
   ```bash
   export T_DNS_SWITCH="2026-..T..Z"          # из live-таймлайна (UTC)
   export SOURCE_URL="postgresql://billhub_runtime:***@<yandex>:6432/billhub_db?sslmode=verify-full"
   export SUPABASE_URL="https://<project>.supabase.co"
   export SUPABASE_SERVICE_ROLE_KEY="***"
   export OLD_VPS_SSH="deploy@old.<домен>" OLD_BASE_URL="https://billhub.<домен>"
   ```
2. Возврат DNS на старую VPS (TTL 60 с) — вручную (см. [10-dns-switch-checklist.md](../scripts/cutover/10-dns-switch-checklist.md),
   раздел rollback) или через `DNS_REVERT_CMD`. Затем:
   ```bash
   CONFIRM_DNS_REVERTED=1 bash scripts/cutover/rollback-scenario-b.sh
   ```
   Скрипт по шагам: (1) подтверждение DNS-возврата; (2) снятие maintenance со старой VPS (read-write);
   (3) `delta-replay-yandex-to-supabase.ts --since $T_DNS_SWITCH` — переносит записи Yandex PG, созданные
   после switch, обратно в Supabase. Конфликты → `docs/cutover-artifacts/delta-replay-conflicts.log`.
3. Сверить счётчики ключевых таблиц Supabase с ожидаемыми (с учётом delta). Разрешить конфликты вручную.
4. Smoke на старой VPS. Сообщить пользователям о возврате.

**Риск:** при провале delta-replay возможна потеря последних минут активности (требует ручного review
конфликт-лога). Поэтому B репетируется на staging до cutover (Прогон C, [cutover-rehearsal-plan.md](cutover-rehearsal-plan.md)).

**Ограничения `delta-replay` (учесть при планировании отката, D4):**
- Переносит только НОВЫЕ строки (INSERT). Строки, существовавшие до cutover и **обновлённые** после,
  дают конфликт PK (23505) и НЕ применяются — обновления существующих записей откатом не переносятся.
- Набор таблиц по умолчанию (`DEFAULT_DELTA_TABLES`) НЕ включает `users` (новые регистрации),
  `refresh_tokens` и ряд бизнес-таблиц — при необходимости задавать `--tables` вручную.
- У `users` нет `updated_at`, поэтому его дельта по времени не отслеживается: пользователей, созданных
  после switch (в т.ч. batch-import подрядчиков), переносить вручную.
- Практический вывод: чем дольше новая VPS проработала до отката, тем менее полон replay. Сценарий B
  (минуты) точнее, чем C (дни/недели) — это ещё один аргумент за fix-forward вместо C.

---

## Сценарий C — через дни/недели (крайняя мера)

**По умолчанию НЕ делаем** — fix-forward приоритетнее. Если решение принято (incident-команда + бизнес):

1. Объявить окно обслуживания.
2. Перевести новую VPS в read-only (та же механика, что `02-maintenance-on-old.sh`, но цель — новая VPS).
3. `delta-replay-yandex-to-supabase.ts --since <дата cutover>` на весь объём write с момента cutover (часы).
4. Verification: счётчики таблиц Yandex vs Supabase сходятся (с учётом delta).
5. Возврат DNS на старую VPS, снятие read-only.

**Риск:** окно обслуживания + возможные конфликты replay (ручное разрешение).

---

## Что НЕ делаем (ADR-0006)

- Runtime-fallback в Supabase через переменную окружения — **запрещено** (split-brain).
- Двойную запись из новой инфры в Supabase «на грейс-период» — split-brain risk + нагрузка на read-only Supabase.
- Восстановление старой VPS из бэкапа — она сохранена как есть в read-only.

## Связанные документы

- [ADR-0006](adr/0006-rollback-procedure.md) · [ADR-0005](adr/0005-rpo-rto.md) · [ADR-0003](adr/0003-cutover-db-strategy.md)
- [runbook-incident-response.md](runbook-incident-response.md) · [cutover-rehearsal-plan.md](cutover-rehearsal-plan.md)
- `scripts/cutover/rollback-scenario-a.sh`, `scripts/cutover/rollback-scenario-b.sh`,
  `scripts/delta-replay-yandex-to-supabase.ts`
