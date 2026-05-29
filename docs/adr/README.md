# Architecture Decision Records (ADR)

Архитектурные решения по миграции BillHub на Yandex Managed PostgreSQL, собственную аутентификацию и Cloud.ru S3 (Этап 1), а в перспективе — на 2 backend VM + ALB + Keycloak + AD (Этап 2).

## Формат

Каждый ADR — короткий документ:
- **Status** — proposed / accepted / superseded
- **Context** — почему вообще встал вопрос
- **Decision** — что решили
- **Consequences** — последствия (плюсы и минусы)
- **Alternatives** — что рассматривали и почему отвергли

ADR не переписывается после accepted — если решение меняется, создаётся новый ADR с пометкой `supersedes` на старый.

## Текущие ADR

| № | Название | Status |
|---|---|---|
| [0001](0001-deviations-from-corp-standard.md) | Отклонения от корпоративного стандарта v3 | accepted |
| [0002](0002-sql-first-drizzle.md) | SQL-first режим Drizzle ORM | accepted |
| [0003](0003-cutover-db-strategy.md) | Стратегия cutover БД Supabase → Yandex PG | accepted |
| [0004](0004-cutover-files-strategy.md) | Стратегия миграции файлов Cloudflare R2 → Cloud.ru S3 | accepted |
| [0005](0005-rpo-rto.md) | RPO / RTO для Cutover 1 | accepted |
| [0006](0006-rollback-procedure.md) | Процедура rollback Cutover 1 | accepted |

## Связанные документы

- [docs/migration-cutover.md](../migration-cutover.md) — общий cutover-runbook
- [docs/migration-inventory.md](../migration-inventory.md) — инвентаризация (таблицы, функции, S3-keys, connection budget)
- [docs/runbook-vps-migration.md](../runbook-vps-migration.md) — runbook миграции backend на другую VPS
- [temp/corp_standard_full.md](../../temp/corp_standard_full.md) — корпоративный стандарт v3
