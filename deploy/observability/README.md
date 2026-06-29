# Observability baseline (§11, ADR-0007)

Минимальный набор «обязательных» алертов single-VPS до подключения Sentry SaaS (отложено, ADR-0007).
Скрипт [healthchecks.sh](healthchecks.sh) покрывает: TLS cert-expiry, disk, CPU/mem, docker health, API uptime.
Прикладные мониторы (dead jobs, DB connections, S3 error-rate) уже работают внутри приложения
(`server/src/plugins/maintenance.ts`, Iteration 7) и пишут в `audit_log`.

## Канал алертов (C-alert)

Скрипт шлёт алерты туда, что задано в env (иначе — только stdout/лог):

| Канал                                    | Переменные                               |
| ---------------------------------------- | ---------------------------------------- |
| Generic webhook (Mattermost/Slack-совм.) | `ALERT_WEBHOOK_URL`                      |
| Telegram                                 | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` |

Пороги: `DISK_PCT_MAX` (85), `MEM_PCT_MAX` (90), `LOAD_PER_CPU_MAX` (2.0), `CERT_DAYS_MIN` (14).

## Установка в cron (на хосте)

```bash
# каждые 10 минут; env-канал — через /etc/billhub/observability.env
( crontab -l 2>/dev/null; \
  echo "*/10 * * * * set -a; . /etc/billhub/observability.env 2>/dev/null; set +a; /opt/portals/billhub/deploy/observability/healthchecks.sh >> /var/log/billhub-healthchecks.log 2>&1" \
) | crontab -
```

`/etc/billhub/observability.env` (640 root) — например:

```
ALERT_WEBHOOK_URL=https://chat.example/hooks/xxxx
# или
TELEGRAM_BOT_TOKEN=123:abc
TELEGRAM_CHAT_ID=-100123
```

## Внешний uptime

Дополнительно настройте внешний uptime-мониторинг (UptimeRobot/Uptime Kuma) на `https://<домен>/api/health/live`
— чтобы ловить недоступность всей VPS, когда локальный cron не сработает.

## Sentry (отложено)

`SENTRY_DSN` (backend) и `VITE_SENTRY_DSN`/release/sourcemap-token (frontend) — заделы в env. Подключение SDK,
загрузка source maps и scrubbing ПДн/cookies/Authorization/токенов/presigned — этап 2 (ADR-0007).
