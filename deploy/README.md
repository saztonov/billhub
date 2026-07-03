# BillHub — деплой на VPS (single-VPS baseline, multi-portal)

Развёртывание по корпстандарту v3.1 single-VPS ([ADR-0007](../docs/adr/0007-v31-single-vps-alignment.md)),
этап 1. По образцу родственного портала EstiMat. Keycloak/AD, реальный email, Sentry SDK, Container
Registry/CI, Lockbox — этап 2 (явные отклонения, см. ADR-0007).

На одной VPS размещается несколько корпоративных порталов: общий ingress (`infra-nginx`) обслуживает все,
каждый портал — изолированный compose-проект. Деплой одного портала не трогает соседние, nginx и Keycloak.

Плейсхолдер `billhub.example` — реальный домен портала (SAME-ORIGIN: SPA и API на одном домене, C6).

## Архитектура

```
                       VPS (один публичный IP)
Пользователи ─HTTPS─▶ /opt/infra/nginx  (общий nginx + certbot, проект infra-nginx)
                          └ billhub.example
                               ├ /     ─▶ billhub-web    ┐
                               └ /api  ─▶ billhub-api     ├ /opt/portals/billhub (проект billhub)
                                          billhub-worker  ┘   + redis (приватная сеть internal)
                          сеть edge (общая)            сеть internal (приватная портала)
   Yandex Managed PostgreSQL                S3 Cloud.ru
```

| Путь на хосте                   | Что лежит                                     |
| ------------------------------- | --------------------------------------------- |
| `/opt/portals/billhub`          | код портала + сборка образов (git-чекаут)     |
| `/etc/billhub/runtime.env`      | конфиг api+worker (DML), `640 root:docker`    |
| `/etc/billhub/migration.env`    | конфиг migrate (DDL), `640 root:docker`       |
| `/usr/local/bin/deploy-billhub` | симлинк на `deploy/deploy-billhub.sh`         |
| `/opt/infra/nginx`              | общий ingress (nginx + certbot + сертификаты) |
| `/var/lib/billhub/deploy`       | lock, release.state, reports деплоя           |

Состояние — в Managed PG + S3 (backend stateless). Логи — `docker logs`/journald.

> Отклонение §19 (этап 1): образы собираются **на VPS** (`docker compose build`), не в CI с пушем в Yandex
> Container Registry. Контроли — в deploy-скрипте (точный коммит, отказ при dirty repo, commit-SHA теги).

## Обновление портала (portal-scoped)

```bash
deploy-billhub                          # git pull + build + перезапуск web/api/worker (без миграций)
deploy-billhub --migrate                # то же + накат НОВЫХ миграций (stop worker → migrate → up)
deploy-billhub --migrate --maintenance  # миграции в окне обслуживания (несовместимые со старым кодом)
deploy-billhub --branch=hotfix          # деплой другой ветки (или BRANCH=hotfix deploy-billhub)
```

Владелец `/opt/portals/billhub` и `/var/lib/billhub` — деплой-пользователь `corpsu`:
от него скрипт работает напрямую, без sudo. От другого пользователя скрипт сам
перезапустится от `corpsu` через sudo. Чтобы sudo при этом не спрашивал пароль,
добавьте drop-in (один раз, подставьте логин запускающего):

```bash
echo '<логин> ALL=(corpsu) NOPASSWD: /opt/portals/billhub/deploy/deploy-billhub.sh' | sudo tee /etc/sudoers.d/billhub-deploy
sudo chmod 440 /etc/sudoers.d/billhub-deploy
```

Поведение API во время миграции: по умолчанию политика **expand-contract** (только backward-compatible
миграции). Для несовместимых — `--maintenance`. Без `--migrate` при наличии pending-миграций деплой
отклоняется (pending-guard). При сбое — trap поднимает прежний worker.

Запрещены глобальные destructive-команды (`docker system prune -a`, `compose down --volumes`).

## Миграции — только новые

Runner [server/src/cli/migrate.ts](../server/src/cli/migrate.ts) ведёт журнал `_migrations`, накатывает
только отсутствующие, каждую в своей транзакции. Запуск отдельным шагом (DDL-роль `billhub_migration`):

```bash
docker compose -f deploy/docker-compose.prod.yml -p billhub run --rm migrate                    # накат
docker compose -f deploy/docker-compose.prod.yml -p billhub run --rm migrate \
  node dist/cli/migrate.js status --json                                                          # статус
```

## Откат

Предыдущий commit-SHA образ сохраняется (`/var/lib/billhub/deploy/release.state`):

```bash
PREV=$(grep -E '^previous=' /var/lib/billhub/deploy/release.state | cut -d= -f2)
BILLHUB_TAG="$PREV" docker compose -f deploy/docker-compose.prod.yml -p billhub up -d billhub-web billhub-api billhub-worker
```

Данные — managed-бэкап/ PITR Yandex PG.

## Установка с нуля

См. [VPS-SETUP.md](VPS-SETUP.md) (часть 1 — хост: docker, сеть `edge`, infra-nginx; часть 2 — портал).
Observability-алерты — [observability/README.md](observability/README.md).
