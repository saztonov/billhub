#!/usr/bin/env bash
#
# 09-smoke-temp-domain.sh — короткий Playwright-smoke через ВРЕМЕННЫЙ домен (план Iteration 10,
# шаг 9/12, T0+60). До DNS-switch: проверяем новую VPS на копии prod-данных через temp-домен
# (basic-auth + IP-allowlist). Провал → rollback Сценарий A (DNS ещё на старой VPS).
#
# Чек-лист smoke (migration-cutover.md шаг 7): логин под 4 ролями ПРЕЖНИМ паролем, создание заявки,
# загрузка файла, OCR-задача, согласование, СБ-флоу. Креды берутся из E2E_*_EMAIL/PASSWORD (реальные
# из копии prod-данных) — см. e2e/helpers/config.ts. Для синтетики SMOKE_SPEC=e2e/smoke-synthetic.spec.ts.
#
# Идемпотентно: повторный прогон перезапускает тесты (на стенде — ожидаемые тестовые данные).
#
# Переменные окружения:
#   TEMP_BASE_URL    URL temp-домена новой VPS (https://temp.billhub.example)         [обязательна]
#   SMOKE_SPEC       что прогонять (по умолчанию e2e/role-based — логины прежними паролями + флоу)
#   E2E_*_EMAIL/PASSWORD  реальные учётки по ролям (для копии prod-данных)
#   PLAYWRIGHT_ARGS  доп. аргументы playwright (напр. --grep)
#   DRY_RUN          1 — печатать команду, не выполнять
#
# Выход: 0 — smoke зелёный; !=0 — провал (rollback A).

set -euo pipefail

CUTOVER_SCRIPT_NAME="09-smoke-temp-domain"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$here/../.." && pwd)"
# shellcheck disable=SC2034
CUTOVER_REPO_ROOT="$repo_root"
# shellcheck source-path=SCRIPTDIR
# shellcheck source=lib/common.sh
source "$here/lib/common.sh"

SMOKE_SPEC="${SMOKE_SPEC:-e2e/role-based}"

main() {
  init_logging
  require_env TEMP_BASE_URL
  require_cmd npx
  log "=== ШАГ 9/12: Playwright smoke через temp-домен ($TEMP_BASE_URL), T0+60 ==="
  log "Спека: $SMOKE_SPEC. Провал → rollback Сценарий A (DNS ещё на старой VPS)."

  if [[ "$DRY_RUN" == "1" ]]; then
    log "[dry-run] SMOKE_BASE_URL=$TEMP_BASE_URL npx playwright test $SMOKE_SPEC --reporter=list,html ${PLAYWRIGHT_ARGS:-}"
    log "[dry-run] Smoke не выполнялся."
    exit 0
  fi

  local -a pw_extra=()
  [[ -n "${PLAYWRIGHT_ARGS:-}" ]] && read -ra pw_extra <<< "$PLAYWRIGHT_ARGS"
  ( cd "$repo_root" && SMOKE_BASE_URL="$TEMP_BASE_URL" \
      npx playwright test "$SMOKE_SPEC" --reporter=list,html "${pw_extra[@]}" ) \
    || fail "Playwright smoke на temp-домене ПРОВАЛЕН — rollback Сценарий A (см. playwright-report/)."

  log "ГОТОВО. Smoke на temp-домене зелёный. Далее — шаг 10 (ТОЧКА НЕВОЗВРАТА: DNS-switch)."
}

main "$@"
