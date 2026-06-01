#!/usr/bin/env bash
#
# bootstrap-schema.sh — bootstrap чистой Yandex Managed PostgreSQL для BillHub (Iteration 8).
#
# Альтернатива удалённому baseline-миграции 0000 (план Iteration 6 «Финальная архитектура
# миграций», принцип 6). Два шага:
#   1. sed-фильтрация Supabase-специфики из sql/schema/schema.sql (raw pg_dump) → psql.
#   2. Инкрементальные миграции (0001+) через собственный runner (server/dist/cli/migrate.js)
#      с checksum-валидацией; assertNotSupabase() защищает от подачи Supabase-URL (принцип 1).
#
# НЕ использует drizzle-kit push/generate (ADR-0002).
#
# Требования: psql (postgresql-client), GNU sed, node (собранный server: `npm run build` в server/).
#
# Переменные окружения:
#   DATABASE_MIGRATION_URL   строка подключения billhub_migration к Yandex PG (DDL)   [обязательна]
#                            формат: postgresql://billhub_migration:***@host:6432/billhub_db?sslmode=verify-full
#   PGSSLROOTCERT            путь к Yandex CA (для sslmode=verify-full), напр. /etc/yandex-pg/ca.crt
#   SCHEMA_SQL               путь к raw-дампу (по умолчанию sql/schema/schema.sql)
#   MIGRATE_JS               путь к собранному runner-у (по умолчанию server/dist/cli/migrate.js)
#   DRY_RUN                  1 — печатать отфильтрованную схему в stdout, ничего не применять
#
# Выход: 0 — bootstrap успешен; !=0 — ошибка (ON_ERROR_STOP прерывает на первой SQL-ошибке).

set -euo pipefail

log()  { printf '[bootstrap] %s\n' "$*"; }
fail() { printf '[bootstrap][ОШИБКА] %s\n' "$*" >&2; exit 1; }

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$here/.." && pwd)"

SCHEMA_SQL="${SCHEMA_SQL:-$repo_root/sql/schema/schema.sql}"
MIGRATE_JS="${MIGRATE_JS:-$repo_root/server/dist/cli/migrate.js}"
SED_FILTER="$here/lib/supabase-schema-filter.sed"

command -v sed >/dev/null 2>&1 || fail "не найден sed"
[[ -f "$SCHEMA_SQL" ]]   || fail "не найден SCHEMA_SQL: $SCHEMA_SQL"
[[ -f "$SED_FILTER" ]]   || fail "не найден sed-фильтр: $SED_FILTER"

# DRY_RUN: только печать отфильтрованной схемы (для аудита/диффа), без подключения к БД.
if [[ "${DRY_RUN:-0}" == "1" ]]; then
  log "DRY_RUN=1 — печать отфильтрованной схемы, БД не трогаем."
  sed -E -f "$SED_FILTER" "$SCHEMA_SQL"
  exit 0
fi

command -v psql >/dev/null 2>&1 || fail "не найден psql (установите postgresql-client)"
command -v node >/dev/null 2>&1 || fail "не найден node"
[[ -n "${DATABASE_MIGRATION_URL:-}" ]] || fail "не задана DATABASE_MIGRATION_URL"
[[ -f "$MIGRATE_JS" ]] || fail "не найден migrate runner: $MIGRATE_JS (соберите server: npm --prefix server run build)"

# Защита принципа 1 на уровне shell (дублирует assertNotSupabase в runner-е): не подаём Supabase-host.
case "$DATABASE_MIGRATION_URL" in
  *supabase.co/*|*supabase.com/*|*pooler.supabase.com/*)
    [[ "${ALLOW_SUPABASE_MIGRATIONS:-0}" == "1" ]] \
      || fail "DATABASE_MIGRATION_URL указывает на Supabase-host — отказ (принцип 1). Override: ALLOW_SUPABASE_MIGRATIONS=1" ;;
esac

# --- Шаг 1: baseline на лету (sed-фильтрация Supabase-специфики → psql, ON_ERROR_STOP) ---
log "Шаг 1/2: применение отфильтрованной схемы из $SCHEMA_SQL …"
sed -E -f "$SED_FILTER" "$SCHEMA_SQL" \
  | psql "$DATABASE_MIGRATION_URL" -v ON_ERROR_STOP=on -q -f -
log "Схема применена."

# --- Шаг 2: инкрементальные миграции 0001+ через собственный runner ---
log "Шаг 2/2: инкрементальные миграции (runner с checksum, assertNotSupabase) …"
node "$MIGRATE_JS"
log "Bootstrap завершён успешно."
