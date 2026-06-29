#!/usr/bin/env bash
# Baseline-алерты single-VPS (§11, ADR-0007): TLS cert-expiry, disk, CPU/mem, docker health, API uptime.
# Sentry SDK отложен — это минимальный набор «обязательных» проверок стандарта.
#
# Запуск из cron на хосте (см. deploy/observability/README.md):
#   */10 * * * * /opt/portals/billhub/deploy/observability/healthchecks.sh >> /var/log/billhub-healthchecks.log 2>&1
#
# КАНАЛ АЛЕРТОВ (C-alert) — задаётся env (что задано, туда и шлём; иначе только stdout):
#   ALERT_WEBHOOK_URL          — generic POST {"text": "..."} (Mattermost/Slack-совместимый)
#   TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID — Telegram sendMessage
# Пороги переопределяются env: DISK_PCT_MAX(85) MEM_PCT_MAX(90) LOAD_PER_CPU_MAX(2.0) CERT_DAYS_MIN(14)
set -uo pipefail

DISK_PCT_MAX="${DISK_PCT_MAX:-85}"
MEM_PCT_MAX="${MEM_PCT_MAX:-90}"
CERT_DAYS_MIN="${CERT_DAYS_MIN:-14}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1/api/health/live}"
CERT_DIR="${CERT_DIR:-/opt/infra/nginx/certbot/conf/live}"

ALERTS=()
add_alert() { ALERTS+=("$1"); echo "ALERT: $1"; }

notify() {
  local text="$1"
  if [ -n "${ALERT_WEBHOOK_URL:-}" ]; then
    curl -fsS -X POST -H 'Content-Type: application/json' \
      --data "$(printf '{"text":"%s"}' "${text//\"/\'}")" "$ALERT_WEBHOOK_URL" >/dev/null 2>&1 || true
  fi
  if [ -n "${TELEGRAM_BOT_TOKEN:-}" ] && [ -n "${TELEGRAM_CHAT_ID:-}" ]; then
    curl -fsS "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
      --data-urlencode "chat_id=${TELEGRAM_CHAT_ID}" \
      --data-urlencode "text=${text}" >/dev/null 2>&1 || true
  fi
}

# --- Диск ---
disk_pct="$(df -P / | awk 'NR==2 {gsub("%","",$5); print $5}')"
[ -n "$disk_pct" ] && [ "$disk_pct" -ge "$DISK_PCT_MAX" ] && add_alert "Диск / заполнен на ${disk_pct}% (порог ${DISK_PCT_MAX}%)"

# --- Память ---
if command -v free >/dev/null 2>&1; then
  mem_pct="$(free | awk '/^Mem:/ {printf "%d", $3/$2*100}')"
  [ -n "$mem_pct" ] && [ "$mem_pct" -ge "$MEM_PCT_MAX" ] && add_alert "Память занята на ${mem_pct}% (порог ${MEM_PCT_MAX}%)"
fi

# --- Нагрузка на CPU (loadavg на ядро) ---
if [ -r /proc/loadavg ]; then
  cpus="$(nproc 2>/dev/null || echo 1)"
  load1="$(cut -d' ' -f1 /proc/loadavg)"
  over="$(awk -v l="$load1" -v c="$cpus" -v m="${LOAD_PER_CPU_MAX:-2.0}" 'BEGIN{print (l/c > m) ? 1 : 0}')"
  [ "$over" = "1" ] && add_alert "Высокая нагрузка CPU: load1=${load1} на ${cpus} ядер"
fi

# --- Docker health: нездоровые контейнеры ---
if command -v docker >/dev/null 2>&1; then
  unhealthy="$(docker ps --filter health=unhealthy --format '{{.Names}}' 2>/dev/null | paste -sd, -)"
  [ -n "$unhealthy" ] && add_alert "Нездоровые контейнеры: ${unhealthy}"
fi

# --- TLS cert-expiry ---
if [ -d "$CERT_DIR" ]; then
  for cert in "$CERT_DIR"/*/fullchain.pem; do
    [ -f "$cert" ] || continue
    end="$(openssl x509 -enddate -noout -in "$cert" 2>/dev/null | cut -d= -f2)"
    [ -n "$end" ] || continue
    end_ts="$(date -d "$end" +%s 2>/dev/null || echo 0)"
    now_ts="$(date +%s)"
    days="$(( (end_ts - now_ts) / 86400 ))"
    [ "$days" -le "$CERT_DAYS_MIN" ] && add_alert "Сертификат $(basename "$(dirname "$cert")") истекает через ${days} дн (порог ${CERT_DAYS_MIN})"
  done
fi

# --- API uptime ---
curl -fsS --max-time 5 "$HEALTH_URL" >/dev/null 2>&1 || add_alert "API недоступен: ${HEALTH_URL}"

# --- Доставка ---
if [ "${#ALERTS[@]}" -gt 0 ]; then
  notify "BillHub healthcheck: $(printf '%s; ' "${ALERTS[@]}")"
  exit 1
fi
echo "healthcheck: ok ($(date -u +%FT%TZ))"
