# ADR-0002: SQL-first режим Drizzle ORM

**Status:** accepted (2026-05-30)

## Context

Backend BillHub переезжает с `@supabase/supabase-js` (PostgREST) на Drizzle ORM против Yandex Managed PostgreSQL (Этап 1, итерации 4–5). У Drizzle есть два workflow:

1. **TS-first (schema-first)** — схема описывается в TypeScript, `drizzle-kit generate` порождает SQL-миграции. Стандартный поток для green-field проектов.
2. **SQL-first** — SQL-миграции пишутся вручную, TS-схема следует через `drizzle-kit introspect`.

Корпоративный стандарт v3 раздел 8 явно требует SQL-first подход:

> миграции выполняются в SQL-first подходе; хранятся как versioned SQL files; являются источником правды для production schema changes; не изменяются задним числом после попадания в общую ветку; исправляются новой миграцией; применяются отдельным deployment step; не запускаются автоматически из backend или worker контейнеров; drizzle-kit push не используется в production.

Существующий процесс проекта уже SQL-first: `sql/migrations/001`…`006` — versioned SQL files, написанные вручную.

## Decision

Drizzle ORM работает в **SQL-first режиме**:

- **SQL-миграции в `sql/migrations/NNNN_*.sql` — единственный источник правды** для production schema changes. Пишутся вручную как versioned SQL files. Не изменяются задним числом после merge в main; исправляются новой миграцией.
- **TypeScript-схема Drizzle** в `server/src/db/schema/*.ts` — производная от SQL. Генерируется через `drizzle-kit introspect:pg` против эталонной БД с накаченным baseline + всеми миграциями. При необходимости подправляется вручную (имена relations, узкие типы, helper-обёртки), но в пределах того, что введено SQL-ом.
- **`drizzle-kit generate` НЕ используется** — он порождал бы SQL из TS, что противоречит SQL-first.
- **`drizzle-kit push` НЕ используется** ни в dev, ни в production (раздел 8 стандарта).
- **Migration runner** — собственный CLI на `postgres.js` (`server/src/cli/migrate.ts`). Логика:
  - Системная таблица `_migrations (version int PK, name text, checksum text, applied_at timestamptz)`.
  - Читает каталог `sql/migrations/`, сортирует по номеру.
  - Применяет ещё не применённые миграции в транзакции (одна миграция = одна транзакция), фиксирует SHA-256 checksum файла.
  - Checksum-несоответствие УЖЕ применённой миграции → ошибка, не молчаливая переапликация (защита от случайного редактирования старой миграции).
  - Запускается отдельным контейнером под пользователем `billhub_migration` в deployment pipeline; в backend/worker контейнерах не запускается.
  - Альтернатива — `drizzle-kit migrate` в режиме «только применить готовые SQL-файлы», если он окажется удобнее (решение в итерации 4 при имплементации).
- **CI drift-проверка:** в `ci.yml` запускается `drizzle-kit introspect:pg` против testcontainers-PG с накаченным baseline + всеми миграциями; результат сравнивается с коммитнутой TS-схемой. Расхождение → красный билд (значит, кто-то изменил TS-схему без соответствующей SQL-миграции, или SQL-миграция изменила схему, а TS-схема не обновлена).
- **Workflow правки БД:** написать SQL-миграцию → применить на dev → `drizzle-kit introspect:pg` → review TS-diff → commit обе части в один PR → CI проверяет drift.

## Consequences

**Плюсы:**
- Полное соответствие стандарту v3 разделу 8.
- Существующие миграции 001–006 не переписываются — они уже SQL-first.
- SQL — единственный артефакт, который применяется в production; TS-схема — артефакт компиляции, может быть восстановлена в любой момент.
- DBA-friendly: ревью SQL-миграций — стандартная практика, не требует знания Drizzle DSL.
- CI drift-проверка ловит расхождения автоматически.

**Минусы:**
- Чуть больше ручной работы при изменениях БД (нужно написать SQL и обновить TS), но это компенсируется надёжностью.
- `drizzle-kit introspect` иногда генерирует менее красивую TS-схему, чем то, что вы написали бы вручную. Локальные правки (relations, custom types) переживают повторный introspect — у Drizzle есть механизм аннотаций для preserve.

## Alternatives

- **TS-first с `drizzle-kit generate`** — отвергнут как противоречащий разделу 8 стандарта. Миграции, сгенерированные ORM, могут содержать неожиданный SQL (например, для refactor-операций) — для production это риск.
- **`drizzle-kit push` в dev** — отвергнут даже для dev: создаёт дрифт между dev и prod БД, не оставляет аудита изменений в SQL.
- **Полностью без Drizzle ORM, оставаться на raw SQL через `postgres.js`** — рассматривался; отвергнут потому, что Drizzle даёт типобезопасные query-builders и сильно сокращает boilerplate в `Repository`-слое, не отказываясь при этом от SQL-first.

## Связанные ADR

- [ADR-0003: Cutover-стратегия БД](0003-cutover-db-strategy.md) — baseline-миграция `0000_baseline.sql` как первый SQL-файл новой схемы.
