# shellcheck shell=bash
#
# nginx-maint.sh — общие функции переключения nginx-конфига по SSH для maintenance-скриптов
# (02-maintenance-on-old.sh, 12-maintenance-off.sh, rollback-scenario-a.sh). Источается ПОСЛЕ common.sh.
#
# Механизм (принцип 1: единственное изменение старого прода — read-only, БЕЗ деплоя кода):
#   подменяем активный конфиг во фронтенд-nginx (/etc/nginx/conf.d/default.conf внутри контейнера,
#   см. Dockerfile.frontend) через `docker cp` + `nginx -t` + `nginx -s reload`. Оригинал сохраняется
#   на хосте (для отката). Идемпотентность обеспечивает вызывающий скрипт (детекция маркера до swap).
#
# Все функции — для РЕАЛЬНОГО запуска; вызывающий скрипт сам гасит их под DRY_RUN (печатает план).

[[ -n "${_CUTOVER_NGINX_MAINT_SH:-}" ]] && return 0
_CUTOVER_NGINX_MAINT_SH=1

# nm_ssh TARGET "command" — выполнить команду на удалённом хосте.
nm_ssh() { local t="$1"; shift; ssh -o BatchMode=yes "$t" "$@"; }

# nm_put TARGET LOCAL_FILE REMOTE_PATH — скопировать локальный файл на удалённый хост (через stdin).
nm_put() { local t="$1" local_f="$2" remote_p="$3"; nm_ssh "$t" "cat > '$remote_p'" <"$local_f"; }

# nm_container_id TARGET DIR FILE SERVICE — id контейнера nginx (через docker compose ps -q).
nm_container_id() {
  local t="$1" dir="$2" file="$3" svc="$4"
  nm_ssh "$t" "cd '$dir' && docker compose -f '$file' ps -q '$svc'"
}

# nm_http_code URL [METHOD] — HTTP-код ответа (для verification). По умолчанию GET.
nm_http_code() {
  local url="$1" method="${2:-GET}"
  curl -ksS -o /dev/null -w '%{http_code}' -X "$method" --max-time 20 "$url"
}

# nm_has_marker URL — 0, если ответ содержит маркер X-BillHub-Maintenance (детекция read-only режима).
nm_has_marker() {
  curl -ksSI --max-time 20 "$1" 2>/dev/null | grep -qi 'X-BillHub-Maintenance'
}

# nm_swap TARGET DIR FILE SERVICE LOCAL_CONF BACKUP_REMOTE — забэкапить активный конфиг (если бэкапа
# ещё нет — не перезатираем оригинал при повторном запуске!), подменить на LOCAL_CONF, nginx -t, reload.
nm_swap() {
  local t="$1" dir="$2" file="$3" svc="$4" local_conf="$5" backup_remote="$6"
  local cid; cid="$(nm_container_id "$t" "$dir" "$file" "$svc")"
  [[ -n "$cid" ]] || { printf 'nm_swap: контейнер nginx (%s) не найден в %s/%s\n' "$svc" "$dir" "$file" >&2; return 1; }
  # Бэкап оригинала только если его ещё нет (идемпотентность: не затирать оригинал maintenance-конфигом).
  nm_ssh "$t" "test -f '$backup_remote' || docker exec '$cid' cat /etc/nginx/conf.d/default.conf > '$backup_remote'"
  nm_put "$t" "$local_conf" "$dir/.nginx-swap.conf"
  nm_ssh "$t" "docker cp '$dir/.nginx-swap.conf' '$cid':/etc/nginx/conf.d/default.conf \
    && docker exec '$cid' nginx -t \
    && docker exec '$cid' nginx -s reload"
}

# nm_restore TARGET DIR FILE SERVICE BACKUP_REMOTE — вернуть сохранённый оригинал конфига + reload.
nm_restore() {
  local t="$1" dir="$2" file="$3" svc="$4" backup_remote="$5"
  local cid; cid="$(nm_container_id "$t" "$dir" "$file" "$svc")"
  [[ -n "$cid" ]] || { printf 'nm_restore: контейнер nginx (%s) не найден\n' "$svc" >&2; return 1; }
  nm_ssh "$t" "test -f '$backup_remote'" || { printf 'nm_restore: бэкап %s не найден на хосте\n' "$backup_remote" >&2; return 1; }
  nm_ssh "$t" "docker cp '$backup_remote' '$cid':/etc/nginx/conf.d/default.conf \
    && docker exec '$cid' nginx -t \
    && docker exec '$cid' nginx -s reload"
}
