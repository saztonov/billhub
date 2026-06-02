#!/usr/bin/env bash
#
# 04-pg-restore-yandex.sh — restore финального дампа в Yandex PG + schema-diff sanity
# (план Iteration 10, шаг 4/12, T0+15; ADR-0003 полный re-restore, НЕ инкрементальный).
#
# Зеркалит «генеральную репетицию» scripts/dump-and-restore.sh (Iteration 9): данные грузятся
# в УЖЕ забутстрапленную схему (schema.sql + миграции 0001/0002/0003) через pg_restore --data-only
# --schema=public -j 4. Перед restore данные чистятся (RESET_MODE), чтобы не было конфликтов PK с
# копией T1, наполненной в Iteration 9.
#
# ПОСЛЕ restore — sanity-check (требование плана): набор public-таблиц живой Yandex PG = schema.sql
# + ТОЛЬКО ожидаемые новые (refresh_tokens, password_reset_tokens, outbox, jobs_log, audit_log + его
# партиции audit_log_*). Любое иное расхождение = провал (значит к Supabase/схеме применили что-то
# незапланированное после Iteration 9).
#
# Идемпотентность: RESET_MODE очищает данные до restore, поэтому повторный запуск даёт тот же
# результат (truncate→restore детерминирован). Через billhub_migration (DDL/DML прав достаточно).
#
# Переменные окружения:
#   DATABASE_MIGRATION_URL  billhub_migration к Yandex PG (цель restore + sanity)        [обязательна]
#   DUMP_FILE               custom-format дамп из шага 3 (по умолчанию ./cutover.dump)
#   RESET_MODE              truncate (по умолчанию, managed-safe) | db-recreate | skip
#   DATABASE_ADMIN_URL      для RESET_MODE=db-recreate: подключение к maintenance-БД (postgres) с CREATEDB
#   TARGET_DB_NAME          имя целевой БД для db-recreate (по умолчанию billhub_db)
#   SUPABASE_DB_URL         если задан — дополнительная сверка count(*) ключевых таблиц (ADR-0003)
#   SCHEMA_SQL              raw-дамп схемы (по умолчанию sql/schema/schema.sql)
#   JOBS                    параллелизм pg_restore -j (по умолчанию 4)
#   DRY_RUN                 1 — печатать намерения, ничего не менять
#
# Выход: 0 — restore + sanity зелёные; !=0 — провал.

set -euo pipefail

CUTOVER_SCRIPT_NAME="04-pg-restore-yandex"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$here/../.." && pwd)"
# shellcheck disable=SC2034
CUTOVER_REPO_ROOT="$repo_root"
# shellcheck source-path=SCRIPTDIR
# shellcheck source=lib/common.sh
source "$here/lib/common.sh"

DUMP_FILE="${DUMP_FILE:-$repo_root/cutover.dump}"
SCHEMA_SQL="${SCHEMA_SQL:-$repo_root/sql/schema/schema.sql}"
RESET_MODE="${RESET_MODE:-truncate}"
TARGET_DB_NAME="${TARGET_DB_NAME:-billhub_db}"
JOBS="${JOBS:-4}"
ARTIFACTS="$repo_root/docs/cutover-artifacts"

KEY_TABLES=(users payment_requests contract_requests payment_request_files)
EXPECTED_NEW=(refresh_tokens password_reset_tokens outbox jobs_log audit_log)

# Прикладные таблицы из отфильтрованной schema.sql (тот же sed-фильтр, что в bootstrap-schema.sh).
schema_sql_tables() {
  DRY_RUN=1 bash "$repo_root/scripts/bootstrap-schema.sh" 2>/dev/null \
    | grep -ioE 'CREATE TABLE (IF NOT EXISTS )?(public\.)?"?[a-z_][a-z0-9_]*"?' \
    | sed -E 's/.* (IF NOT EXISTS )?//; s/public\.//; s/"//g' \
    | sort -u
}

# public BASE TABLE из живой Yandex PG.
yandex_tables() {
  psql "$DATABASE_MIGRATION_URL" -tAc \
    "SELECT table_name FROM information_schema.tables
     WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name"
}

# --- Reset данных перед restore --------------------------------------------
reset_target() {
  case "$RESET_MODE" in
    skip) log "RESET_MODE=skip — очистка данных пропущена (повторный прогон/оператор очистил сам)."; return 0 ;;
    db-recreate)
      log "RESET_MODE=db-recreate: DROP/CREATE DATABASE $TARGET_DB_NAME (ADR-0003 §10.4, нужен CREATEDB) + bootstrap …"
      [[ -n "${DATABASE_ADMIN_URL:-}" ]] || fail "RESET_MODE=db-recreate требует DATABASE_ADMIN_URL (maintenance-БД с CREATEDB)"
      assert_not_supabase "$DATABASE_ADMIN_URL" "DATABASE_ADMIN_URL"
      if [[ "$DRY_RUN" == "1" ]]; then
        log "[dry-run] psql ADMIN: DROP DATABASE IF EXISTS $TARGET_DB_NAME WITH (FORCE); CREATE DATABASE $TARGET_DB_NAME;"
        log "[dry-run] bootstrap-schema.sh (schema.sql + миграции 0001+)"
        return 0
      fi
      psql "$DATABASE_ADMIN_URL" -v ON_ERROR_STOP=on -c \
        "DROP DATABASE IF EXISTS $TARGET_DB_NAME WITH (FORCE); CREATE DATABASE $TARGET_DB_NAME;" \
        || fail "DROP/CREATE DATABASE не выполнен (проверьте права CREATEDB у пользователя ADMIN-URL)"
      DATABASE_MIGRATION_URL="$DATABASE_MIGRATION_URL" bash "$repo_root/scripts/bootstrap-schema.sh" \
        || fail "bootstrap схемы после db-recreate не выполнен"
      ;;
    truncate)
      log "RESET_MODE=truncate (managed-safe): очистка данных всех public-таблиц (кроме _migrations) …"
      if [[ "$DRY_RUN" == "1" ]]; then
        log "[dry-run] TRUNCATE всех public BASE TABLE (искл. _migrations и партиции audit_log_*) RESTART IDENTITY CASCADE"
        return 0
      fi
      psql "$DATABASE_MIGRATION_URL" -v ON_ERROR_STOP=on <<'SQL' || fail "TRUNCATE не выполнен"
DO $$
DECLARE
  stmt text;
BEGIN
  SELECT string_agg(format('%I', tablename), ', ')
    INTO stmt
  FROM pg_tables
  WHERE schemaname = 'public'
    AND tablename <> '_migrations'
    AND tablename NOT LIKE 'audit_log_%';
  IF stmt IS NOT NULL THEN
    EXECUTE 'TRUNCATE TABLE ' || stmt || ' RESTART IDENTITY CASCADE';
    RAISE NOTICE 'TRUNCATE выполнен для: %', stmt;
  END IF;
END $$;
SQL
      ;;
    *) fail "RESET_MODE должен быть truncate | db-recreate | skip (дано: $RESET_MODE)" ;;
  esac
}

# --- pg_restore --data-only -j N -------------------------------------------
restore_data() {
  log "pg_restore -j $JOBS --data-only --schema=public --disable-triggers $DUMP_FILE …"
  if [[ "$DRY_RUN" == "1" ]]; then
    log "[dry-run] pg_restore --dbname=<migration> --data-only --no-owner --no-privileges --schema=public -j $JOBS --disable-triggers '$DUMP_FILE'"
    return 0
  fi
  [[ -f "$DUMP_FILE" ]] || fail "не найден дамп: $DUMP_FILE (запустите шаг 3)"
  mkdir -p "$ARTIFACTS"
  # pg_restore может вернуть !=0 на безобидных NOTICE; критерий успеха — verification ниже.
  pg_restore --dbname="$DATABASE_MIGRATION_URL" \
    --data-only --no-owner --no-privileges \
    --schema=public -j "$JOBS" --disable-triggers \
    "$DUMP_FILE" 2>"$ARTIFACTS/cutover_db_pg_restore.log" || true
  log "Restore завершён (лог: docs/cutover-artifacts/cutover_db_pg_restore.log). Критерий — sanity ниже."
}

# --- Sanity: набор таблиц == schema.sql + только ожидаемые новые -----------
verify_schema() {
  log "Sanity: набор public-таблиц Yandex == schema.sql + {${EXPECTED_NEW[*]} (+ audit_log_*)} …"
  if [[ "$DRY_RUN" == "1" ]]; then log "[dry-run] pg_dump --schema-only(live tables) + diff со schema.sql"; return 0; fi
  local tmp; tmp="$(mktemp -d)"
  # shellcheck disable=SC2064
  trap "rm -rf '$tmp'" RETURN

  yandex_tables | sort -u >"$tmp/yandex.txt"
  schema_sql_tables >"$tmp/schema.txt"
  { cat "$tmp/schema.txt"; printf '%s\n' _migrations "${EXPECTED_NEW[@]}"; } | sort -u >"$tmp/expected.txt"

  local unexpected missing
  unexpected="$(comm -23 "$tmp/yandex.txt" "$tmp/expected.txt" | grep -vE '^audit_log_' || true)"
  missing="$(comm -23 "$tmp/schema.txt" "$tmp/yandex.txt" || true)"

  if [[ -n "$missing" ]]; then
    log "ОТСУТСТВУЮТ прикладные таблицы:"; printf '%s\n' "$missing" | sed 's/^/  - /'
    fail "набор таблиц Yandex не содержит всех таблиц schema.sql (restore/bootstrap неполный)."
  fi
  if [[ -n "$unexpected" ]]; then
    log "НЕОЖИДАННЫЕ таблицы (не из schema.sql и не из ожидаемых новых):"; printf '%s\n' "$unexpected" | sed 's/^/  - /'
    fail "schema-drift: расхождения помимо ожидаемых новых таблиц — анализ перед продолжением cutover."
  fi
  local nt
  for nt in "${EXPECTED_NEW[@]}"; do
    grep -qx "$nt" "$tmp/yandex.txt" || fail "ожидаемая новая таблица отсутствует: $nt"
  done
  log "  ✓ Набор таблиц соответствует ожиданиям (schema.sql + только новые из 0001/0002)."
}

# --- (опц.) сверка count(*) ключевых таблиц Supabase vs Yandex --------------
verify_counts() {
  [[ -n "${SUPABASE_DB_URL:-}" ]] || { log "SUPABASE_DB_URL не задан — count-сверка пропущена (sanity по схеме уже выполнен)."; return 0; }
  if [[ "$DRY_RUN" == "1" ]]; then log "[dry-run] сверка count(*) ${KEY_TABLES[*]} (Supabase vs Yandex)"; return 0; fi
  log "Сверка count(*) ключевых таблиц (Supabase vs Yandex) …"
  local t src dst
  for t in "${KEY_TABLES[@]}"; do
    src="$(psql "$SUPABASE_DB_URL" -tAc "SELECT count(*) FROM public.$t" | tr -d '[:space:]')" || fail "count $t из Supabase не прочитан"
    dst="$(psql "$DATABASE_MIGRATION_URL" -tAc "SELECT count(*) FROM public.$t" | tr -d '[:space:]')" || fail "count $t из Yandex не прочитан"
    [[ "$src" == "$dst" ]] || fail "count($t): Supabase=$src != Yandex=$dst — данные перенесены не полностью."
    log "  ✓ $t: $src == $dst"
  done
}

main() {
  init_logging
  require_env DATABASE_MIGRATION_URL
  require_cmd pg_restore
  require_cmd psql
  require_cmd sort
  require_cmd comm
  assert_not_supabase "$DATABASE_MIGRATION_URL" "DATABASE_MIGRATION_URL"
  [[ -r "$SCHEMA_SQL" ]] || fail "не найден SCHEMA_SQL: $SCHEMA_SQL"

  log "=== ШАГ 4/12: pg_restore в Yandex PG ($(db_host "$DATABASE_MIGRATION_URL")) + schema sanity, T0+15 ==="
  reset_target
  restore_data
  verify_schema
  verify_counts
  log "ГОТОВО. Данные восстановлены, schema sanity зелёный. Далее — шаг 5 (import-passwords)."
}

main "$@"
