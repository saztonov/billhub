# ADR-0007: Выравнивание под корпстандарт v3.1 (single-VPS) по эталону EstiMat

**Status:** accepted (2026-06-30)

## Context

Появился корпстандарт **v3.1, single-VPS baseline** (`temp/corp_standard_short_single_vps.md`). Относительно
v3 (см. [ADR-0001](0001-deviations-from-corp-standard.md)) он официально благословляет single-VPS («2 VM +
ALB» больше не отклонение), но заносит в baseline часть пунктов, которые v3 откладывал.

Родственный портал **EstiMat** уже реализует целевую раскладку на том же стандарте (docker-compose,
single-VPS, multi-portal, общий `infra-nginx` + per-portal compose-проект, deploy-скрипт с двумя режимами,
миграции отдельным one-shot сервисом). BillHub приводится к этому образцу.

База BillHub уже соответствует стандарту: Fastify/TS/Drizzle/zod/pino, Yandex Managed PG, SQL-first миграции
с журналом `_migrations` (накат только новых), отдельный migration-user, Cloud.ru S3 (presigned +
upload-session), transactional outbox.

## Decision

### Что сделано в этом выравнивании

| Область | Решение |
|---|---|
| Раскладка (§1) | Контейнерная модель: `/opt/portals/billhub` (код+сборка), `/etc/billhub/*.env` (640 root:docker), `/opt/infra/nginx` (общий ingress), симлинк `/usr/local/bin/deploy-billhub`. Эталон в `deploy/`. |
| Два compose-проекта (§1,§4) | `deploy/infra-nginx/` (ingress + certbot) и `deploy/docker-compose.prod.yml` (портал: billhub-api/web/worker/redis/migrate). Общая сеть `edge`; redis — в приватной `internal`. |
| Frontend ownership (C1) | SPA — в собственном образе `billhub-web` (статика), обновляется portal-деплоем. infra-nginx — чистый edge. |
| Домен (C6) | SAME-ORIGIN: один домен, path-routing (`/`→web, `/api`→api). Сохраняет cookie-auth (SameSite=Lax без Domain). |
| nginx-директивы (C7) | Перенесены спец-правила: upload без буферизации, download streaming, SSE, `client_max_body_size 110m`. |
| Миграции в образе (C2) | `server/Dockerfile` собирается из корня репо и кладёт `sql/migrations` в `/app/sql/migrations` (нужно и API при startup checks, и сервису migrate); путь задан `MIGRATIONS_DIR`. |
| Миграции «только новые» | Журнал `_migrations` (было); добавлены `status --json` (pending-guard деплоя), advisory-lock, assertWritablePrimary. |
| Секреты (§5, C5) | Раздельные env-файлы: `runtime.env` (api+worker, DML) и `migration.env` (только migrate, DDL). DDL-креды не попадают в runtime-контейнеры. |
| Deploy-скрипт (§10/§19) | `deploy-billhub.sh` два режима: без миграций / `--migrate`. Safety: flock-lock, commit-SHA теги, pending-guard, failure-recovery (trap поднимает прежний worker), `--maintenance`, лёгкий report. |
| Email (§8) | Абстракция `@su10/mail` доведена: типизированные шаблоны, audit `mail_sent`/`mail_failed` (без токена), защищённый stub-лог (600, C9). Реальный провайдер — отложено. |
| Observability (§11) | Baseline-алерты `deploy/observability/healthchecks.sh` (cert-expiry/disk/cpu/docker/uptime) + канал (webhook/Telegram). Sentry SDK — отложено. |

### Явные отклонения (как этап-2 EstiMat — НЕ выдаются за соответствие)

| Пункт стандарта | Отклонение | Обоснование |
|---|---|---|
| §2-4 Keycloak + AD federation | Остаётся standalone auth (§13) | Нет инфраструктуры: VPN до DC, LDAPS, развёрнутый Keycloak. EstiMat держит skeleton `infra-keycloak/`; у BillHub — этап 2. |
| §8 реальный email-провайдер | Только абстракция + stub | SES/Postbox-учётки и DNS (SPF/DKIM/DMARC) — этап 2. Замена одного модуля. |
| §19 Yandex Container Registry + CI | build-on-VPS без CR | Как в EstiMat этап 1. Контроли: сборка из точного коммита, отказ при dirty repo, commit-SHA теги, хранение предыдущего образа для отката. |
| §18 Yandex Lockbox | env-файлы 640 root:docker | Допустимый fallback §5/§9. Lockbox — этап 2. |
| §11 Sentry SaaS SDK | baseline-алерты скриптом | cert/disk/cpu/uptime + существующие мониторы; полноценный Sentry (source maps, scrubbing) — этап 2. |

## Consequences

**Плюсы:** раскладка и деплой совпадают с родственным порталом EstiMat (единый операционный опыт на VPS);
self-contained образ с миграциями; безопасный деплой (lock/SHA/guard/recovery); честно зафиксированные отклонения.

**Минусы:** часть техдолга (Keycloak/AD, реальный email, Sentry SDK, CR+CI, Lockbox) перенесена на этап 2.
build-on-VPS — отклонение §19, компенсируется контролями деплой-скрипта.

## Связанные

- [ADR-0001](0001-deviations-from-corp-standard.md) — single-VPS теперь baseline стандарта, а не отклонение.
- [ADR-0002](0002-sql-first-drizzle.md) — SQL-first миграции (без изменений).
- EstiMat `deploy/` — эталон раскладки и deploy-скрипта.
