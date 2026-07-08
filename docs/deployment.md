# Развертывание BillHub на VPS (актуально)

Канонический деплой — v3.1 single-VPS, мультипортальный ([ADR-0007](adr/0007-v31-single-vps-alignment.md)).
Полные инструкции:

- [deploy/README.md](../deploy/README.md) — обзор, обновление, откат, миграции
- [deploy/VPS-SETUP.md](../deploy/VPS-SETUP.md) — установка с нуля (хост + портал)

Этот документ — обзор реальной прод-раскладки и эксплуатационные рецепты. Прежняя all-in-one схема (Supabase,
root `docker-compose.production.yml`) — [deployment_old.md](deployment_old.md) (архив, на VPS2 не используется).

## Оглавление

1. [Архитектура](#архитектура)
2. [Домены и сеть](#домены-и-сеть)
3. [Что где на VPS](#что-где-на-vps)
4. [Первичная установка](#первичная-установка)
5. [Обновление портала](#обновление-портала)
6. [Изменение только окружения (env)](#изменение-только-окружения-env)
7. [Добавление домена к порталу](#добавление-домена-к-порталу)
8. [Миграции](#миграции)
9. [Откат](#откат)
10. [Проверка работоспособности](#проверка-работоспособности)

---

## Архитектура

```
                       VPS (один публичный IP)
Пользователи ─HTTPS─▶ /opt/infra/nginx  (общий nginx + certbot, проект infra-nginx)
                          ├ rp.su10.ru / ravek.link ─▶ billhub-web   ┐
                          │                            billhub-api    ├ /opt/portals/billhub (проект billhub)
                          │                            billhub-worker ┘   + redis (сеть internal)
                          ├ estimat.su10.ru ─▶ портал EstiMat
                          └ auth.su10.ru    ─▶ Keycloak
   Yandex Managed PostgreSQL              S3 Cloud.ru              OpenRouter (OCR)
```

На одной VPS размещается несколько корпоративных порталов. Общий ingress `infra-nginx` (nginx + certbot)
обслуживает все; каждый портал — изолированный compose-проект. Деплой одного портала не трогает соседние,
nginx и Keycloak. BillHub соседствует с `estimat.su10.ru` и `auth.su10.ru` — их конфиги и сертификаты не трогать.

### Контейнеры портала BillHub (проект `billhub`)

| Сервис | Образ | Назначение |
|---|---|---|
| billhub-web | nginx:alpine | SPA-статика (собрана с пустым `VITE_API_URL` ⇒ относительный `/api`, same-origin) |
| billhub-api | node:20 | Fastify API (standalone-auth, `AUTH_MODE=standalone`), stateless |
| billhub-worker | node:20 | BullMQ-воркеры (OCR + обработка файлов) |
| redis | redis:7-alpine | Очереди BullMQ + сессии chunked-upload (приватная сеть `internal`) |
| migrate | node:20 | Разовый накат миграций (profile `migrate`, DDL-роль) |

Состояние — во внешнем Yandex Managed PostgreSQL и S3 (backend stateless). Логи — `docker logs`.

### Интеграции

- **БД:** внешний Yandex Managed PostgreSQL (в compose портала postgres нет). Две роли: `billhub_runtime` (DML,
  runtime.env) и `billhub_migration` (DDL, migration.env). TLS `verify-full` (Yandex CA через `NODE_EXTRA_CA_CERTS`).
- **Файлы:** Cloud.ru S3 (`STORAGE_PROVIDER=cloudru`).
- **OCR:** OpenRouter.
- Supabase в активном standalone-пути не используется (переменные `SUPABASE_*` нужны config.ts при старте только
  как непустые non-placeholder значения — для rollback-скриптов).

---

## Домены и сеть

- **Публичный IP VPS:** `89.232.188.170`.
- **Домены BillHub (same-origin, SPA и API на одном origin):** `rp.su10.ru`, `ravek.link`, `www.ravek.link`.
- **DNS `ravek.link`** — на njalla: A-запись `ravek.link → 89.232.188.170`, CNAME `www.ravek.link → ravek.link`.
- **SSL:** один SAN-сертификат (lineage `rp.su10.ru`) покрывает все три домена. Выпуск/продление — webroot через
  `infra-certbot`.
- Наружу открыты только `80/443` (infra-nginx). Контейнеры порталов — во внутренних docker-сетях: `edge` (общая с
  ingress) и `internal` (приватная сеть портала для redis/БД). Redis наружу не смотрит.

---

## Что где на VPS

| Путь на хосте | Что лежит |
|---|---|
| `/opt/portals/billhub` | код портала + сборка образов (git-чекаут; владелец — деплой-пользователь) |
| `/etc/billhub/runtime.env` | конфиг api+worker (DML, S3, JWT, `CORS_ORIGIN`), `640 root:docker` |
| `/etc/billhub/migration.env` | конфиг migrate (DDL, `DATABASE_MIGRATION_URL`), `640 root:docker` |
| `/usr/local/bin/deploy-billhub` | симлинк на `deploy/deploy-billhub.sh` |
| `/opt/infra/nginx` | общий ingress: `conf.d/<portal>.conf`, `certbot/conf` (сертификаты), `certbot/www` (webroot) |
| `/var/lib/billhub/deploy` | lock, `release.state` (current/previous SHA), reports (владелец — деплой-пользователь) |
| `/etc/yandex-pg/ca.crt` | CA Yandex PG для TLS verify-full |

---

## Первичная установка

С нуля (подготовка хоста + портала) — [deploy/VPS-SETUP.md](../deploy/VPS-SETUP.md).

Предпосылки, которые легко упустить:
- каталоги `/opt/portals/billhub` и `/var/lib/billhub/deploy` должны принадлежать деплой-пользователю; иначе git
  выдаёт `dubious ownership`, а на lock-файле — `Permission denied`;
- деплой-пользователь — в группе `docker`;
- образы тегируются commit-SHA; при «грязном» рабочем дереве деплой отказывается собирать.

---

## Обновление портала

```bash
deploy-billhub                          # git pull + build + перезапуск web/api/worker (без миграций)
deploy-billhub --migrate                # то же + накат НОВЫХ миграций (stop worker → migrate → up)
deploy-billhub --migrate --maintenance  # миграции в окне обслуживания (несовместимые со старым кодом)
BRANCH=hotfix deploy-billhub            # деплой другой ветки
```

По умолчанию политика **expand-contract** (только backward-compatible миграции). Без `--migrate` при наличии
непримененных миграций деплой отклоняется (pending-guard). При сбое trap поднимает прежний worker.

---

## Изменение только окружения (env)

Правки `/etc/billhub/runtime.env` применяются **только пересозданием контейнера** (`up -d`), а НЕ `restart`:

> `docker compose restart` не перечитывает `env_file` — переменные фиксируются при создании контейнера, старые
> значения останутся. Нужен `up -d` (пересоздание) или `deploy-billhub`.

Самый простой способ — прогнать `deploy-billhub` (пересоберёт и пересоздаст). Точечно, без пересборки — пересоздать
нужный сервис, переиспользовав тег текущего образа (образы тегируются commit-SHA, `latest` может не быть):

```bash
TAG=$(docker inspect --format '{{.Config.Image}}' billhub-billhub-api-1 | cut -d: -f2)
BILLHUB_TAG="$TAG" docker compose -f deploy/docker-compose.prod.yml -p billhub up -d billhub-api
# проверить, что значение подхватилось:
docker compose -f deploy/docker-compose.prod.yml -p billhub exec billhub-api printenv CORS_ORIGIN
```

Если env читает и worker — пересоздать и `billhub-worker` тем же образом.

---

## Добавление домена к порталу

Пример: добавить `ravek.link` (+ `www`) к уже работающему `rp.su10.ru`. Приложение домен-независимо (куки host-only,
фронт ходит на относительный `/api`), поэтому меняется только конфигурация сервера.

**1. DNS.** A-запись домена → IP VPS (для `www` — CNAME на apex). Дождаться распространения — все публичные резолверы
должны отдавать новый IP (иначе ACME-проверка уйдёт на старый адрес):

```bash
for r in 8.8.8.8 1.1.1.1 9.9.9.9; do echo -n "$r -> "; dig +short ravek.link @$r; done
```

**2. Сертификат.** Расширить существующий SAN-lineage, перечислив ВСЕ его домены (итог = ровно список `-d`). Затрагивает
только указанный `--cert-name`, соседние сертификаты не трогает:

```bash
docker exec infra-certbot certbot certonly --webroot -w /var/www/certbot \
  --cert-name rp.su10.ru --key-type ecdsa --expand \
  -d rp.su10.ru -d ravek.link -d www.ravek.link -n --agree-tos
docker exec infra-certbot certbot certificates   # проверить, что расширился только нужный
```

**3. nginx.** Добавить домен(ы) в `server_name` обоих блоков (`:80` и `:443`) `/opt/infra/nginx/conf.d/billhub.conf`
(пути к сертификату не меняются — SAN покрывает новые домены):

```bash
sudo sed -i 's/server_name rp.su10.ru;/server_name rp.su10.ru ravek.link www.ravek.link;/g' \
  /opt/infra/nginx/conf.d/billhub.conf
docker exec infra-nginx nginx -t && docker exec infra-nginx nginx -s reload
```

**4. CORS.** В `/etc/billhub/runtime.env` — `CORS_ORIGIN` списком origin через запятую (парсер поддерживает мультидомен),
затем пересоздать API (см. [Изменение только окружения](#изменение-только-окружения-env)):

```
CORS_ORIGIN=https://rp.su10.ru,https://ravek.link,https://www.ravek.link
```

Проверка preflight — origin должен отражаться:

```bash
curl -fsSI -X OPTIONS https://ravek.link/api/auth/login \
  -H 'Origin: https://ravek.link' -H 'Access-Control-Request-Method: POST' | grep -i access-control-allow-origin
```

---

## Миграции

Накатываются только новые (журнал `_migrations`), каждая в своей транзакции, отдельным шагом (DDL-роль):

```bash
docker compose -f deploy/docker-compose.prod.yml -p billhub run --rm migrate                     # накат
docker compose -f deploy/docker-compose.prod.yml -p billhub run --rm migrate \
  node dist/cli/migrate.js status --json                                                          # статус
```

Обычно запускается через `deploy-billhub --migrate`. Подробности — [deploy/README.md](../deploy/README.md).

---

## Откат

Код — ключом `--previous` (переключение на предыдущий commit-SHA образ без пересборки; `current`/`previous`
в release.state меняются местами, повторный вызов вернёт обратно). БД — из дампа, который скрипт автоматически
снимает перед каждым `--migrate` (`/var/lib/billhub/deploy/db-backups`, 2 последних):

```bash
deploy-billhub --previous                  # откат только кода
deploy-billhub --previous --restore-db     # откат кода И БД на точку «до миграции» (подтверждение yes)
deploy-billhub --restore-db                # только БД (миграция упала до переключения кода)
```

ВАЖНО: откат образов не отменяет миграции БД; restore теряет все данные, записанные после снятия дампа
(RPO = старт pg_dump; для рискованных миграций — `--maintenance`, там RPO нулевой). Дампы содержат ПДн и
хэши паролей/токенов. Fallback вручную и детали — [deploy/README.md](../deploy/README.md#откат).

Долгосрочная страховка данных — managed-бэкап / PITR Yandex PG.

---

## Проверка работоспособности

```bash
# по каждому домену:
curl -fsS https://rp.su10.ru/api/health/ready; echo
curl -fsS https://ravek.link/api/health/ready; echo
curl -fsS https://www.ravek.link/api/health/ready; echo

# контейнеры и логи:
docker compose -f deploy/docker-compose.prod.yml -p billhub ps
docker compose -f deploy/docker-compose.prod.yml -p billhub logs --tail=50 billhub-api
```

`health/ready` возвращает статус БД, миграций (`applied`/`expected`), redis и S3. В браузере — открыть домен,
залогиниться (проверяет куки/CORS), загрузить и скачать файл.
