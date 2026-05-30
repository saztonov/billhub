# Repository слой (Strangler Fig)

Этот слой вводит абстракцию доступа к данным, чтобы текущий `@supabase/supabase-js` мог быть постепенно заменён на Drizzle ORM против Yandex Managed PostgreSQL без переписывания бизнес-логики.

## Структура

- `types.ts` — общие типы (DTO, фильтры, pagination).
- `<domain>.repository.ts` — интерфейс репозитория для конкретного домена (Counterparty, Supplier, User, PaymentRequest, ContractRequest, Approval, File и т.д.).
- `<domain>.supabase.ts` — реализация через `@supabase/supabase-js` (текущий runtime).
- `<domain>.drizzle.ts` — реализация через Drizzle (вводится в Iteration 4).

## Принципы

1. **Интерфейс — единственная точка контакта бизнес-логики.** Роуты в `routes/` не должны напрямую обращаться к `fastify.supabase` или `db` — только через `request.server.repos.<domain>`.

2. **DTO нормализованы.** Repository всегда возвращает `camelCase`-объекты согласно типам из `src/types/index.ts` (фронта). snake_case → camelCase делается на границе репозитория, не в `preSerialization` hook.

3. **Strangler Fig.** Реализации Supabase и Drizzle могут сосуществовать; runtime выбирает через feature-флаг `DB_PROVIDER=supabase|drizzle`. В production `NODE_ENV=production` обязателен `DB_PROVIDER=drizzle` (startup-инвариант, см. ADR-0001).

4. **Drizzle-impl запрещён к runtime-переключению на supabase.** SupabaseRepository остаётся в коде ТОЛЬКО для миграционных и rollback-скриптов через явные CLI-параметры (ADR-0006).

5. **Тестируемость.** Каждый интерфейс должен иметь in-memory мок-реализацию для unit-тестов бизнес-логики. Эта реализация (`<domain>.memory.ts`) живёт в `src/test/repositories/`.

## Roadmap

- **Iteration 3** (этот шаг): интерфейсы + zod-схемы + плагин `repositoriesPlugin`. Supabase-реализация существующих роутов оборачивается в адаптер. Бизнес-логика пока продолжает использовать `fastify.supabase` напрямую — миграция роутов происходит в Iterations 4–5.
- **Iteration 4**: введение Drizzle ORM SQL-first + baseline `0000_baseline.sql` + `DrizzleRepository` параллельно с Supabase. Чтения переводятся на Drizzle.
- **Iteration 5**: записи переводятся на Drizzle с транзакциями. `DB_PROVIDER=drizzle` становится default.
