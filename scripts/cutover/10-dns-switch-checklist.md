# Шаг 10/12 — DNS cutover (РУЧНАЯ операция оператора, ТОЧКА НЕВОЗВРАТА)

**Когда:** T0+76, после зелёного smoke на temp-домене (шаг 9) и решения incident-команды.
**Тип:** ручная операция — НЕ bash-скрипт (DNS-провайдеры различны; ошибка автоматизации здесь
необратима). Рубеж между rollback-сценариями: до этого шага — Сценарий A (дёшево), после — Сценарий B
(revert DNS + delta-replay). См. [ADR-0005](../../docs/adr/0005-rpo-rto.md), [ADR-0006](../../docs/adr/0006-rollback-procedure.md).

> **DNS TTL основного домена должен быть заранее (≥48 ч) снижен до 60 сек** — см. pre-cutover чек-лист
> в [migration-cutover.md](../../docs/migration-cutover.md). Без этого propagation выйдет за RTO.

---

## Предусловия (НЕ переключать, пока не выполнено)

- [ ] Шаги 1–9 завершены (preflight зелёный, старый прод read-only, dump/restore/import/файлы/startup/smoke OK).
- [ ] **Decision-checklist incident-команды заполнен и подписан** — все пункты ✓, решение «ПРИНИМАЕМ cutover».
      См. [docs/cutover-artifacts/decision-checklist.md](../../docs/cutover-artifacts/decision-checklist.md).
- [ ] Live-таймлайн ведётся ([timeline-template.md](../../docs/cutover-artifacts/timeline-template.md)).
- [ ] Канал инцидента активен, вся команда на связи.

## Процедура переключения

1. [ ] **Зафиксировать `T_dns_switch`** (UTC, до секунды) — в live-таймлайн и в переменную окружения для
       возможного rollback B (`T_DNS_SWITCH`). Это нижняя граница окна delta-replay (ADR-0006 §B).
2. [ ] Обновить **A-запись** (и AAAA, если есть) основного домена `billhub.<домен>` на **статический IP
       новой VPS**. Проверить, что меняется именно prod-зона, а не staging.
3. [ ] Если домен за CDN/прокси (Cloudflare и т.п.) — переключить origin/также учесть кэш прокси.
4. [ ] Дождаться propagation: TTL 60 с + кэш резолвера. Проверка из нескольких точек:
   - `dig +short billhub.<домен>` (ожидается IP новой VPS) с разных резолверов (1.1.1.1, 8.8.8.8, локальный);
   - онлайн DNS-propagation checker (несколько регионов).
5. [ ] Подтвердить, что `https://billhub.<домен>` резолвится на новую VPS (заголовок/баннер/версия сборки).

## После переключения

- [ ] Перейти к шагу 11 — `11-smoke-production.sh` (smoke через основной домен).
- [ ] Если smoke провален и быстрый fix-forward невозможен → **rollback Сценарий B**:
      `rollback-scenario-b.sh` (revert DNS на старую VPS + `delta-replay` записей после `T_dns_switch`).

## Заметки по rollback DNS (Сценарий B)

- Возврат A-записи на **старую VPS** (она в read-only — снимет maintenance `rollback-scenario-b.sh`).
- TTL 60 с обеспечивает быстрый возврат (~1–2 мин propagation).
- `T_dns_switch` критичен: всё, что записано в Yandex PG ПОСЛЕ него, переносится обратно в Supabase
  через `scripts/delta-replay-yandex-to-supabase.ts` (вызывается из `rollback-scenario-b.sh`).
