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
| `/var/lib/billhub/deploy`       | lock, release.state, reports, db-backups      |

Состояние — в Managed PG + S3 (backend stateless). Логи — `docker logs`/journald.

> Отклонение §19 (этап 1): образы собираются **на VPS** (`docker compose build`), не в CI с пушем в Yandex
> Container Registry. Контроли — в deploy-скрипте (точный коммит, отказ при dirty repo, commit-SHA теги).

## Обновление портала (portal-scoped)

```bash
deploy-billhub                          # git pull + build + перезапуск web/api/worker (без миграций)
deploy-billhub --migrate                # то же + дамп БД + накат НОВЫХ миграций (stop worker → dump → migrate → up)
deploy-billhub --migrate --maintenance  # миграции в окне обслуживания (несовместимые со старым кодом)
deploy-billhub --branch=hotfix          # деплой другой ветки (или BRANCH=hotfix deploy-billhub)
deploy-billhub --previous               # откат кода на предыдущий образ (без пересборки, секунды)
deploy-billhub --previous --restore-db  # аварийный откат кода И БД на точку «до миграции»
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
отклоняется (pending-guard). При сбое recovery-trap возвращает остановленные сервисы на прежний тег;
исключение — прерванный `pg_restore`: сервисы остаются остановленными (разбор вручную).

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

**Код** — ключом `--previous`: сервисы переключаются на предыдущий commit-SHA образ (хранится
локально, `previous=` в `/var/lib/billhub/deploy/release.state`) без пересборки, за секунды.
После отката `current`/`previous` меняются местами — повторный `--previous` вернёт обратно.

```bash
deploy-billhub --previous
```

Откат образов НЕ отменяет миграции БД. Если откатываемый деплой был с `--migrate` и миграция
несовместима со старым кодом — откатывайте вместе с базой (ниже).

**БД** — перед каждым `--migrate` скрипт автоматически снимает полный дамп (`pg_dump -Fc`,
каталог `/var/lib/billhub/deploy/db-backups`, хранятся 2 последних + metadata). Восстановление:

```bash
deploy-billhub --previous --restore-db     # типовой аварийный случай: откат кода И БД на точку «до миграции»
deploy-billhub --restore-db                # только БД (миграция упала до переключения кода)
deploy-billhub --restore-db=<файл.dump>    # явный выбор дампа (имя файла из db-backups)
```

Restore — destructive: **теряются все данные, записанные после снятия дампа** (RPO = момент
старта pg_dump; в обычном `--migrate` API продолжает принимать записи, поэтому для рискованных
миграций используйте `--maintenance` — там API остановлен до дампа и RPO нулевой). Скрипт
показывает выбранный дамп (дату, коммиты из metadata) и требует подтверждения `yes`; перед
restore автоматически снимается аварийный `prerestore-*` дамп текущего состояния. Guard: если
код уже переключён на новую версию, standalone `--restore-db` откажет и потребует
`--previous --restore-db`. При провале pg_restore сервисы остаются остановленными — разбор
вручную (restore идёт одной транзакцией, но состояние БД нужно проверить).

Дампы содержат ПДн и хэши паролей/токенов — не копировать с сервера, права 700/600.

**Fallback** (вручную, без скрипта; `--no-build` обязателен — иначе compose может пересобрать
отсутствующий тег из текущего дерева):

```bash
PREV=$(grep -E '^previous=' /var/lib/billhub/deploy/release.state | cut -d= -f2)
BILLHUB_TAG="$PREV" docker compose -f deploy/docker-compose.prod.yml -p billhub up -d --no-build billhub-web billhub-api billhub-worker
```

Долгосрочная страховка данных — managed-бэкап / PITR Yandex PG (восстановление в новый кластер).

## Установка с нуля

См. [VPS-SETUP.md](VPS-SETUP.md) (часть 1 — хост: docker, сеть `edge`, infra-nginx; часть 2 — портал).
Observability-алерты — [observability/README.md](observability/README.md).
