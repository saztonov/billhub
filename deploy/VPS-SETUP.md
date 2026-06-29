# BillHub — настройка VPS с нуля (single-VPS baseline)

Дополняет [README.md](README.md). Замените `billhub.example` и `<IP>`/`<pg-host>` на реальные значения.

---

# ЧАСТЬ 1. Хост (один раз на VPS)

Выполняется при подготовке VPS к первому порталу. Для последующих — пропускается.

### 1.1. Базовое

- Ubuntu 22.04/24.04, пользователь с `sudo`, член группы `docker`.
- Firewall: наружу только `80/443`; SSH (`22`) — с доверенных IP/через VPN.
- Установлены Docker Engine + compose plugin.

### 1.2. Общая docker-сеть

```bash
docker network create edge
```

### 1.3. Общий ingress (nginx + certbot)

Эталон — в репо первого портала (`deploy/infra-nginx/`).

```bash
sudo mkdir -p /opt/infra/nginx
sudo cp -r /opt/portals/billhub/deploy/infra-nginx/. /opt/infra/nginx/
cd /opt/infra/nginx
mkdir -p certbot/conf certbot/www
docker compose -p infra-nginx up -d        # стартует с :80 + ACME (C8), без 443
docker compose -p infra-nginx ps
```

---

# ЧАСТЬ 2. Портал BillHub

### 2.1. Внешние ресурсы

**Yandex Managed PostgreSQL** — БД и два пользователя:

```sql
CREATE DATABASE billhub_db;
CREATE USER billhub_runtime   WITH PASSWORD '...';   -- DML, conn_limit 30
CREATE USER billhub_migration WITH PASSWORD '...';   -- DDL, conn_limit 5
\c billhub_db
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
```

Bootstrap чистой схемы — `scripts/bootstrap-schema.sh`. Включить backups + PITR; доступ к PG — только с IP VPS.

**S3 Cloud.ru:** bucket `billhub-s3` (приватный) + сервисный ключ.
**DNS:** A-запись `billhub.example` → `<IP>`.

### 2.2. Код и окружение

```bash
sudo mkdir -p /opt/portals && sudo chown "$USER":"$USER" /opt/portals
cd /opt/portals
git clone <repo-url> billhub
cd billhub

# Секреты — два файла (C5), 640 root:docker:
sudo mkdir -p /etc/billhub
sudo install -m 640 -o root -g docker deploy/etc-billhub/runtime.env.example   /etc/billhub/runtime.env
sudo install -m 640 -o root -g docker deploy/etc-billhub/migration.env.example /etc/billhub/migration.env
openssl rand -base64 48     # сгенерировать AUTH_JWT_SECRET / CSRF_SECRET / AUDIT_HMAC_KEY
sudo nano /etc/billhub/runtime.env       # БД(runtime), S3, JWT, CORS_ORIGIN=https://billhub.example, ...
sudo nano /etc/billhub/migration.env     # DATABASE_MIGRATION_URL (DDL)

# Деплой-скрипт в PATH:
sudo ln -sf /opt/portals/billhub/deploy/deploy-billhub.sh /usr/local/bin/deploy-billhub
sudo chmod +x /opt/portals/billhub/deploy/deploy-billhub.sh
```

### 2.3. Первый запуск с миграциями (portal-scoped)

```bash
deploy-billhub --migrate
docker compose -f deploy/docker-compose.prod.yml -p billhub ps
docker compose -f deploy/docker-compose.prod.yml -p billhub logs --tail=50 billhub-api
```

### 2.4. Подключение к ingress (C8 — сертификат ДО 443-блока)

```bash
# 1) Выпустить сертификат (webroot, infra-nginx уже обслуживает ACME):
docker run --rm \
  -v /opt/infra/nginx/certbot/conf:/etc/letsencrypt \
  -v /opt/infra/nginx/certbot/www:/var/www/certbot \
  certbot/certbot certonly --webroot -w /var/www/certbot \
  -d billhub.example --email admin@billhub.example --agree-tos --no-eff-email

# 2) Подключить server-блок портала (заменив домен) и перечитать nginx:
sed 's/billhub.example/billhub.example/' \
  /opt/portals/billhub/deploy/nginx/billhub.conf | sudo tee /opt/infra/nginx/conf.d/billhub.conf >/dev/null
docker exec infra-nginx nginx -t
docker exec infra-nginx nginx -s reload
```

Reload после автопродления сертификатов (один раз):

```bash
( crontab -l 2>/dev/null; echo "0 3 * * * docker exec infra-nginx nginx -s reload" ) | crontab -
```

### 2.5. Проверка

```bash
curl -fsS https://billhub.example/api/health/live     # {"status":"ok"}
curl -fsS https://billhub.example/api/health/ready     # связь с БД
```

Откройте `https://billhub.example` — UI грузится, login/refresh работают (same-origin cookies), загрузка/
скачивание файлов и SSE работают через ingress, HTTP редиректит на HTTPS.

### 2.6. Observability

Настройте baseline-алерты — [observability/README.md](observability/README.md).

## Backup / Restore

- **PostgreSQL:** managed-бэкапы Yandex + при необходимости `pg_dump -Fc`.
- **S3:** версионирование bucket средствами Cloud.ru.
- **Конфигурация:** `/etc/billhub/*.env` (вне git), `/opt/infra/nginx/certbot/conf` (сертификаты), `conf.d`.
