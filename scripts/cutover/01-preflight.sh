#!/usr/bin/env bash
#
# 01-preflight.sh — финальный pre-flight перед открытием cutover-окна (план Iteration 10, шаг 1/12).
#
# Запускается ДО шага 2 (maintenance-on). Если хоть одна проверка провалена — окно НЕ открывается,
# пользователи НЕ получают maintenance-страницу, cutover переносится (ADR-0005 «Условия отмены»).
# Идемпотентен и БЕЗ побочных эффектов: только чтение (psql ping, gh api, list-objects, grep).
#
# Проверки (все из плана Iteration 10, раздел «Финальный pre-flight»):
#   1. Рабочее дерево git чистое (нет незакоммиченного) — ADR-0005.
#   2. CI на main зелёный (gh api check-runs). Нет CI → ALLOW_NO_CI=1 для явного подтверждения.
#   3. sql/schema/schema.sql существует и читается.
#   4. Свежий pg_dump --schema-only Supabase == schema.sql по набору public-таблиц
#      (расхождение = к Supabase применили миграцию после Iteration 9 → cutover откладывается).
#   5. Yandex PG доступен (psql SELECT 1) + latency приемлемое (check-pg-latency: median≤30, p95≤50).
#   6. Cloud.ru S3 доступен (list-objects-v2) + manifest актуален (есть и непуст).
#   7. delta-replay-yandex-to-supabase unit-тесты зелёные (rollback-инструмент, ADR-0006).
#   8. Отчёт Iteration 9 DoD присутствует (полная схема тестов зафиксирована отчётом).
#   9. Контакты incident-команды заполнены и timestamp свежий (migration-inventory.md §10).
#
# Любой провал → exit 1 «Cutover откладывается: <причины>». Все проверки выполняются (не fail-fast),
# чтобы оператор увидел сразу все блокеры.
#
# Переменные окружения:
#   SUPABASE_DB_URL            postgres://-источник (read-only) для schema-drift            [для п.4]
#   DATABASE_MIGRATION_URL     billhub_migration к Yandex PG (psql ping)                    [для п.5]
#   DATABASE_URL               billhub_runtime к Yandex PG (для check-pg-latency)           [для п.5]
#   CLOUDRU_ENDPOINT           endpoint Cloud.ru S3 (https://s3.cloud.ru)                   [для п.6]
#   CLOUDRU_BUCKET             бакет Cloud.ru (по умолчанию billhub-s3)                     [для п.6]
#   AWS_PROFILE                профиль aws с креды Cloud.ru                                 [для п.6]
#   GH_MAIN_BRANCH             ветка для CI-проверки (по умолчанию main)
#   ALLOW_NO_CI                1 — допустить отсутствие настроенного CI (явное подтверждение оператора)
#   ITERATION9_REPORT          путь к отчёту Iteration 9 (по умолчанию docs/cutover-artifacts/iteration-9-report.md)
#   CONTACTS_MAX_AGE_DAYS      макс. возраст подтверждения контактов в днях (по умолчанию 30)
#   PG_LATENCY_MEDIAN_MS / PG_LATENCY_P95_MS  пороги (передаются в check-pg-latency)
#   DRY_RUN                    1 — печатать намерения, ничего не выполнять (idempotency-проверка)

set -euo pipefail

# CUTOVER_SCRIPT_NAME/CUTOVER_REPO_ROOT читаются в sourced lib/common.sh (shellcheck не видит связь).
# shellcheck disable=SC2034
CUTOVER_SCRIPT_NAME="01-preflight"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$here/../.." && pwd)"
# shellcheck disable=SC2034
CUTOVER_REPO_ROOT="$repo_root"
# shellcheck source-path=SCRIPTDIR
# shellcheck source=lib/common.sh
source "$here/lib/common.sh"

SCHEMA_SQL="${SCHEMA_SQL:-$repo_root/sql/schema/schema.sql}"
SED_FILTER="${SED_FILTER:-$repo_root/scripts/lib/supabase-schema-filter.sed}"
CLOUDRU_BUCKET="${CLOUDRU_BUCKET:-billhub-s3}"
GH_MAIN_BRANCH="${GH_MAIN_BRANCH:-main}"
ITERATION9_REPORT="${ITERATION9_REPORT:-$repo_root/docs/cutover-artifacts/iteration-9-report.md}"
CONTACTS_MAX_AGE_DAYS="${CONTACTS_MAX_AGE_DAYS:-30}"
INVENTORY="${INVENTORY:-$repo_root/docs/migration-inventory.md}"
ARTIFACTS="$repo_root/docs/cutover-artifacts"

FAILURES=()
note_pass() { printf '  ✓ %s\n' "$1"; }
note_fail() { FAILURES+=("$1"); printf '  ✗ %s\n' "$1"; }
note_skip() { printf '  ~ (dry-run) %s\n' "$1"; }

# Набор public-таблиц из raw pg_dump после единого sed-фильтра (как в bootstrap-schema.sh).
filtered_public_tables() {
  sed -E -f "$SED_FILTER" "$1" \
    | grep -ioE 'CREATE TABLE (IF NOT EXISTS )?(public\.)?"?[a-z_][a-z0-9_]*"?' \
    | sed -E 's/.* (IF NOT EXISTS )?//; s/public\.//; s/"//g' \
    | sort -u
}

# --- 1. git clean -----------------------------------------------------------
check_git_clean() {
  log "Проверка 1/9: рабочее дерево git чистое …"
  if [[ "$DRY_RUN" == "1" ]]; then note_skip "git status --porcelain"; return 0; fi
  require_cmd git
  if [[ -z "$(git -C "$repo_root" status --porcelain)" ]]; then
    note_pass "git дерево чистое"
  else
    note_fail "есть незакоммиченные изменения (ADR-0005: cutover требует чистого main)"
  fi
}

# --- 2. CI green (gh api) ---------------------------------------------------
check_ci_green() {
  log "Проверка 2/9: CI на $GH_MAIN_BRANCH зелёный (gh api) …"
  if [[ "$DRY_RUN" == "1" ]]; then note_skip "gh api check-runs для $GH_MAIN_BRANCH"; return 0; fi
  if ! command -v gh >/dev/null 2>&1; then
    [[ "${ALLOW_NO_CI:-0}" == "1" ]] && { note_pass "gh отсутствует, ALLOW_NO_CI=1 — пропуск (под ответственность оператора)"; return 0; }
    note_fail "gh CLI не найден — не подтвердить CI (override: ALLOW_NO_CI=1)"; return 0
  fi
  local sha conclusion total
  sha="$(git -C "$repo_root" rev-parse "origin/$GH_MAIN_BRANCH" 2>/dev/null || git -C "$repo_root" rev-parse "$GH_MAIN_BRANCH" 2>/dev/null || true)"
  [[ -n "$sha" ]] || { note_fail "не удалось определить SHA $GH_MAIN_BRANCH"; return 0; }
  # check-runs последнего коммита: всех conclusion=success и хотя бы один существует.
  local json
  if ! json="$(gh api "repos/{owner}/{repo}/commits/$sha/check-runs" 2>/dev/null)"; then
    [[ "${ALLOW_NO_CI:-0}" == "1" ]] && { note_pass "gh api недоступен, ALLOW_NO_CI=1 — пропуск"; return 0; }
    note_fail "gh api недоступен/не авторизован — не подтвердить CI (override: ALLOW_NO_CI=1)"; return 0
  fi
  total="$(printf '%s' "$json" | grep -o '"total_count":[0-9]*' | head -1 | grep -o '[0-9]*' || echo 0)"
  if [[ "${total:-0}" == "0" ]]; then
    [[ "${ALLOW_NO_CI:-0}" == "1" ]] && { note_pass "CI не настроен (0 check-runs), ALLOW_NO_CI=1 — пропуск"; return 0; }
    note_fail "CI не настроен (0 check-runs на $GH_MAIN_BRANCH) — настройте CI или ALLOW_NO_CI=1"; return 0
  fi
  # Любой conclusion != success → провал.
  conclusion="$(printf '%s' "$json" | grep -o '"conclusion":"[^"]*"' | grep -v '"conclusion":"success"' | head -1 || true)"
  if [[ -z "$conclusion" ]]; then
    note_pass "все $total check-runs success"
  else
    note_fail "не все CI-проверки success ($conclusion)"
  fi
}

# --- 3. schema.sql readable -------------------------------------------------
check_schema_readable() {
  log "Проверка 3/9: sql/schema/schema.sql существует и читается …"
  if [[ -r "$SCHEMA_SQL" ]]; then note_pass "schema.sql читается ($SCHEMA_SQL)"; else note_fail "schema.sql недоступен: $SCHEMA_SQL"; fi
  [[ -r "$SED_FILTER" ]] || note_fail "sed-фильтр недоступен: $SED_FILTER"
}

# --- 4. Supabase schema drift ----------------------------------------------
check_supabase_schema_drift() {
  log "Проверка 4/9: pg_dump --schema-only Supabase == schema.sql (набор public-таблиц) …"
  if [[ "$DRY_RUN" == "1" ]]; then note_skip "pg_dump --schema-only Supabase + diff таблиц со schema.sql"; return 0; fi
  if [[ -z "${SUPABASE_DB_URL:-}" ]]; then note_fail "не задан SUPABASE_DB_URL — не проверить schema-drift Supabase"; return 0; fi
  if ! command -v pg_dump >/dev/null 2>&1; then note_fail "pg_dump не найден — не проверить schema-drift"; return 0; fi
  [[ -r "$SCHEMA_SQL" && -r "$SED_FILTER" ]] || { note_fail "schema.sql/sed-фильтр недоступны — пропуск drift"; return 0; }
  assert_is_supabase "$SUPABASE_DB_URL" "SUPABASE_DB_URL"
  local tmp; tmp="$(mktemp -d)"
  # shellcheck disable=SC2064
  trap "rm -rf '$tmp'" RETURN
  if ! pg_dump "$SUPABASE_DB_URL" --schema-only --no-owner --no-privileges >"$tmp/live.sql" 2>"$tmp/err"; then
    note_fail "pg_dump --schema-only от Supabase не выполнен ($(tr -d '\n' <"$tmp/err" | tail -c 200))"; return 0
  fi
  filtered_public_tables "$tmp/live.sql" >"$tmp/live_tables.txt"
  filtered_public_tables "$SCHEMA_SQL"   >"$tmp/snap_tables.txt"
  local diff_out; diff_out="$(comm -3 "$tmp/snap_tables.txt" "$tmp/live_tables.txt" || true)"
  if [[ -z "$diff_out" ]]; then
    note_pass "набор public-таблиц Supabase == schema.sql ($(wc -l <"$tmp/snap_tables.txt" | tr -d ' ') таблиц)"
  else
    log "  расхождение таблиц (snapshot ↔ live Supabase):"; printf '    %s\n' "$diff_out"
    note_fail "schema-drift Supabase ↔ schema.sql — к Supabase применили миграцию после Iteration 9; cutover откладывается до анализа и обновления schema.sql"
  fi
}

# --- 5. Yandex PG доступность + latency ------------------------------------
check_yandex_pg() {
  log "Проверка 5/9: Yandex PG доступен (psql SELECT 1) + latency …"
  if [[ "$DRY_RUN" == "1" ]]; then note_skip "psql SELECT 1 + npm run db:latency"; return 0; fi
  if [[ -z "${DATABASE_MIGRATION_URL:-}" && -z "${DATABASE_URL:-}" ]]; then
    note_fail "не заданы DATABASE_MIGRATION_URL/DATABASE_URL — не проверить Yandex PG"; return 0
  fi
  local ping_url="${DATABASE_MIGRATION_URL:-$DATABASE_URL}"
  assert_not_supabase "$ping_url" "ping-URL Yandex PG"
  if command -v psql >/dev/null 2>&1; then
    if psql "$ping_url" -tAc 'SELECT 1' >/dev/null 2>&1; then note_pass "psql SELECT 1 ($(db_host "$ping_url"))"; else note_fail "psql SELECT 1 к Yandex PG не прошёл ($(db_host "$ping_url"))"; fi
  else
    note_fail "psql не найден — не проверить доступность Yandex PG"
  fi
  # Latency — через собранный лаунчер (server/src/cli/check-pg-latency.ts). Требует DATABASE_URL.
  if [[ -n "${DATABASE_URL:-}" ]] && command -v node >/dev/null 2>&1 && command -v npx >/dev/null 2>&1; then
    if ( cd "$repo_root" && DATABASE_URL="$DATABASE_URL" npx tsx scripts/check-pg-latency.ts ) >/dev/null 2>&1; then
      note_pass "latency до Yandex PG в пределах порогов (median≤30мс, p95≤50мс)"
    else
      note_fail "latency до Yandex PG превышает пороги или замер не выполнен (см. check-pg-latency)"
    fi
  else
    log "  (latency-замер пропущен: нет DATABASE_URL/node/npx — проверьте вручную npm --prefix . run … check-pg-latency)"
  fi
}

# --- 6. Cloud.ru S3 + manifest ---------------------------------------------
check_cloudru_s3() {
  log "Проверка 6/9: Cloud.ru S3 доступен + manifest актуален …"
  if [[ "$DRY_RUN" == "1" ]]; then note_skip "aws s3api list-objects-v2 Cloud.ru + наличие manifest"; return 0; fi
  if [[ -z "${CLOUDRU_ENDPOINT:-}" ]]; then note_fail "не задан CLOUDRU_ENDPOINT — не проверить Cloud.ru S3"; return 0; fi
  if command -v aws >/dev/null 2>&1; then
    if aws s3api head-bucket --endpoint-url "$CLOUDRU_ENDPOINT" --bucket "$CLOUDRU_BUCKET" >/dev/null 2>&1; then
      note_pass "Cloud.ru head-bucket '$CLOUDRU_BUCKET' доступен"
    else
      note_fail "Cloud.ru S3 head-bucket '$CLOUDRU_BUCKET' недоступен (endpoint/bucket/creds)"
    fi
  else
    note_fail "aws CLI не найден — не проверить Cloud.ru S3"
  fi
  # Manifest актуальности: после первичной синхронизации T1 должен существовать и быть непуст.
  local m="$ARTIFACTS/manifest_cloudru_T1.json"
  if [[ -s "$m" && "$(tr -d '[:space:]' <"$m")" != "[]" && "$(tr -d '[:space:]' <"$m")" != "null" ]]; then
    note_pass "manifest Cloud.ru T1 присутствует и непуст"
  else
    note_fail "manifest $m отсутствует/пуст — выполните list-r2-manifest.sh SIDE=cloudru (Iteration 9)"
  fi
}

# --- 7. delta-replay unit-тесты --------------------------------------------
check_delta_replay_tests() {
  log "Проверка 7/9: delta-replay unit-тесты зелёные …"
  if [[ "$DRY_RUN" == "1" ]]; then note_skip "npm --prefix server test delta-replay"; return 0; fi
  if command -v npm >/dev/null 2>&1; then
    if ( cd "$repo_root" && npm --prefix server test -- src/cli/delta-replay-yandex-to-supabase.test.ts ) >/dev/null 2>&1; then
      note_pass "delta-replay unit-тесты зелёные"
    else
      note_fail "delta-replay unit-тесты НЕ прошли (rollback-инструмент ADR-0006 обязателен)"
    fi
  else
    note_fail "npm не найден — не прогнать delta-replay unit-тесты"
  fi
}

# --- 8. Отчёт Iteration 9 DoD ----------------------------------------------
check_iteration9_report() {
  log "Проверка 8/9: отчёт Iteration 9 DoD присутствует с вердиктом PASS …"
  if [[ ! -s "$ITERATION9_REPORT" ]]; then
    note_fail "отчёт Iteration 9 отсутствует: $ITERATION9_REPORT (зафиксируйте полную схему тестов перед окном)"
    return 0
  fi
  # Якорь ^ — вердикт ДОЛЖЕН быть отдельной строкой с начала (не inline-упоминание в инструкции).
  if grep -qiE '^ИТОГ:[[:space:]]*PASS' "$ITERATION9_REPORT"; then
    note_pass "отчёт Iteration 9 найден, вердикт ИТОГ: PASS"
  else
    note_fail "в отчёте Iteration 9 нет строки 'ИТОГ: PASS' с начала строки (тесты не зафиксированы как зелёные): $ITERATION9_REPORT"
  fi
}

# --- 9. Контакты incident-команды ------------------------------------------
# Плейсхолдеры детектируются ТОЛЬКО в секции «## 10.» инвентаря (в env-секции легитимны
# <host>/<project>/<secret>, их не считаем за невыполненные контакты).
check_contacts() {
  log "Проверка 9/9: контакты incident-команды заполнены и timestamp свежий …"
  [[ -r "$INVENTORY" ]] || { note_fail "не найден $INVENTORY"; return 0; }
  local section
  section="$(awk '/^## 10\./{f=1;next} /^## /{f=0} f' "$INVENTORY")"
  if [[ -z "$section" ]]; then note_fail "в инвентаре нет секции '## 10. Команда и контакты'"; return 0; fi
  if printf '%s\n' "$section" | grep -qE '_TBD_|<ЗАПОЛНИТЬ|<заполнить'; then
    note_fail "в секции контактов (§10) остались незаполненные плейсхолдеры (_TBD_/<ЗАПОЛНИТЬ>) — заполните контакты"
  else
    note_pass "плейсхолдеров в секции контактов нет"
  fi
  # Строка подтверждения: «Контакты подтверждены (timestamp): YYYY-MM-DD».
  local ts
  ts="$(grep -oE 'Контакты подтверждены \(timestamp\): [0-9]{4}-[0-9]{2}-[0-9]{2}' "$INVENTORY" | grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2}' | head -1 || true)"
  if [[ -z "$ts" ]]; then
    note_fail "нет строки 'Контакты подтверждены (timestamp): YYYY-MM-DD' в инвентаре"
    return 0
  fi
  if ! command -v date >/dev/null 2>&1; then log "  (date недоступен — пропуск проверки свежести)"; return 0; fi
  local ts_epoch now_epoch age_days
  if ts_epoch="$(date -d "$ts" +%s 2>/dev/null)"; then
    now_epoch="$(date +%s)"
    age_days=$(( (now_epoch - ts_epoch) / 86400 ))
    if (( age_days <= CONTACTS_MAX_AGE_DAYS )); then
      note_pass "контакты подтверждены $ts (возраст ${age_days}д ≤ ${CONTACTS_MAX_AGE_DAYS}д)"
    else
      note_fail "подтверждение контактов устарело: $ts (возраст ${age_days}д > ${CONTACTS_MAX_AGE_DAYS}д) — переподтвердите"
    fi
  else
    log "  (не удалось распарсить дату '$ts' — проверьте формат YYYY-MM-DD)"
  fi
}

main() {
  init_logging
  log "=== PRE-FLIGHT CUTOVER 1 (read-only проверки; окно ещё НЕ открыто) ==="
  [[ "$DRY_RUN" == "1" ]] && log "DRY_RUN=1 — внешние пробы пропускаются, проверяется только логика/идемпотентность."

  check_git_clean
  check_ci_green
  check_schema_readable
  check_supabase_schema_drift
  check_yandex_pg
  check_cloudru_s3
  check_delta_replay_tests
  check_iteration9_report
  check_contacts

  echo
  if (( ${#FAILURES[@]} == 0 )); then
    log "PRE-FLIGHT ЗЕЛЁНЫЙ. Все проверки пройдены — окно cutover можно открывать (шаг 2)."
    exit 0
  fi
  log "PRE-FLIGHT ПРОВАЛЕН (${#FAILURES[@]} проблем):"
  local f
  for f in "${FAILURES[@]}"; do printf '   - %s\n' "$f"; done
  fail "Cutover откладывается: ${#FAILURES[@]} непройденных проверок (см. список выше)."
}

main "$@"
