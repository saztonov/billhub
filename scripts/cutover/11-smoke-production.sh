#!/usr/bin/env bash
#
# 11-smoke-production.sh — Playwright-smoke через ОСНОВНОЙ домен после DNS-switch (план Iteration 10,
# шаг 11/12, T0+85). DNS уже переключён на новую VPS (шаг 10). Тот же чек-лист, что на шаге 9, но через
# боевой домен. Провал и невозможность быстрого fix-forward → rollback Сценарий B (revert DNS +
# delta-replay записей после T_dns_switch, ADR-0006).
#
# Идемпотентно: повторный прогон перезапускает тесты. ВНИМАНИЕ: на боевом домене smoke создаёт
# тестовые данные — используйте выделенные тест-учётки / SMOKE_SPEC с безопасным набором.
#
# Переменные окружения:
#   PROD_BASE_URL    основной домен (https://billhub.example)                          [обязательна]
#   SMOKE_SPEC       что прогонять (по умолчанию e2e/role-based — логины прежними паролями + флоу)
#   E2E_*_EMAIL/PASSWORD  реальные учётки по ролям
#   PLAYWRIGHT_ARGS  доп. аргументы playwright (напр. --grep)
#   DRY_RUN          1 — печатать команду, не выполнять
#
# Выход: 0 — smoke зелёный (можно снимать maintenance, шаг 12); !=0 — провал (rollback B/fix-forward).

set -euo pipefail

CUTOVER_SCRIPT_NAME="11-smoke-production"
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
  require_env PROD_BASE_URL
  require_cmd npx
  log "=== ШАГ 11/12: Playwright smoke через основной домен ($PROD_BASE_URL), T0+85 ==="
  log "Спека: $SMOKE_SPEC. Провал без быстрого fix-forward → rollback Сценарий B (revert DNS + delta-replay)."

  if [[ "$DRY_RUN" == "1" ]]; then
    log "[dry-run] SMOKE_BASE_URL=$PROD_BASE_URL npx playwright test $SMOKE_SPEC --reporter=list,html ${PLAYWRIGHT_ARGS:-}"
    log "[dry-run] Smoke не выполнялся."
    exit 0
  fi

  local -a pw_extra=()
  [[ -n "${PLAYWRIGHT_ARGS:-}" ]] && read -ra pw_extra <<< "$PLAYWRIGHT_ARGS"
  ( cd "$repo_root" && SMOKE_BASE_URL="$PROD_BASE_URL" \
      npx playwright test "$SMOKE_SPEC" --reporter=list,html "${pw_extra[@]}" ) \
    || fail "Playwright smoke на основном домене ПРОВАЛЕН — rollback Сценарий B или fix-forward (см. ADR-0006)."

  log "ГОТОВО. Smoke в production зелёный. Далее — шаг 12 (снятие maintenance, go-live)."
}

main "$@"
