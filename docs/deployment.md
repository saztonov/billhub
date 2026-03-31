# Развертывание BillHub на VPS (Docker)

## Оглавление
1. [Архитектура](#архитектура)
2. [Системные требования](#системные-требования)
3. [Структура Docker](#структура-docker)
4. [Первоначальное развертывание](#первоначальное-развертывание)
5. [Настройка nginx](#настройка-nginx)
6. [Проверка работоспособности](#проверка-работоспособности)
7. [Обновление приложения](#обновление-приложения)
8. [Откат](#откат)
9. [Полезные команды](#полезные-команды)

---

## Архитектура

```
Клиент (HTTPS:443)
  → Host nginx (SSL-терминация, Let's Encrypt)
    → Docker frontend nginx (127.0.0.1:3080)
      → статика SPA (React)
      → /api/* → Docker backend Fastify (backend:3000)
        → Redis (redis:6379) — очереди BullMQ
        → Supabase (БД, Auth)
        → Cloud.ru S3 (файлы)
        → OpenRouter (OCR)
```

### Контейнеры

| Сервис | Образ | Порт | Назначение |
|---|---|---|---|
| frontend | nginx:alpine | 127.0.0.1:3080→80 | SPA + reverse proxy к backend |
| backend | node:20-alpine | 3000 (внутренний) | Fastify API-сервер |
| redis | redis:7-alpine | 6379 (внутренний) | Очереди BullMQ (файлы, OCR) |

### Домены
- `ravek.link` — основной домен (SSL: Let's Encrypt, certbot)
- `billhub.fvds.ru` — алиас (SSL: Let's Encrypt, ISPmanager)

### Сеть
- Host nginx слушает на `185.200.179.0:80` и `185.200.179.0:443`
- Docker-контейнеры в bridge-сети `billhub`, не видны снаружи
- Frontend доступен только с localhost (127.0.0.1:3080)

---

## Системные требования

- **ОС:** Ubuntu/Debian
- **RAM:** 4 ГБ (рекомендуется)
- **Диск:** 60 ГБ
- **Docker:** 28+ с Docker Compose v2
- **nginx:** установлен, управляет SSL

### Пользователи
- **root** — настройка nginx, системные пакеты
- **billhub** — работа с приложением, Docker (группа `docker`)

### Ключевые пути
- Репозиторий: `/var/www/billhub/data/billhub-app/`
- Nginx конфиг: `/etc/nginx/vhosts/billhub/billhub.fvds.ru.conf`
- SSL (ravek.link): `/etc/letsencrypt/live/ravek.link/`
- SSL (billhub.fvds.ru): `/var/www/httpd-cert/billhub/billhub.fvds.ru_le1.*`
- Логи nginx: `/var/www/httpd-logs/billhub.fvds.ru.access.log`
- Backend .env: `/var/www/billhub/data/billhub-app/server/.env`

---

## Структура Docker

### docker-compose.yml

3 сервиса: frontend, backend, redis.

- Frontend: порт `127.0.0.1:3080:80`, зависит от healthy backend
- Backend: `env_file: ./server/.env`, лимит памяти 768M, healthcheck на `/api/health`
- Redis: `maxmemory 64mb`, политика `noeviction` (требование BullMQ)
- Volumes: `upload-temp` (временные файлы), `redis-data` (данные очередей)

### Dockerfile.frontend (multi-stage)

1. Builder: `node:20-alpine` → `npm ci` → `npm run build`
2. Production: `nginx:alpine` → копирует `dist/` и `nginx.conf`

### server/Dockerfile (multi-stage)

1. Builder: `node:20-bookworm-slim` (Debian, для совместимости node-canvas с g++) → `npm ci` → `npm run build`
2. Production: `node:20-alpine` + нативные библиотеки (cairo, pango) → `--max-old-space-size=512`

### nginx.conf (Docker frontend)

- `/assets/` — кэш 1 год (файлы с хэшем в имени)
- `/index.html` — без кэша (no-cache, no-store)
- `/api/files/upload/` — лимит 6 МБ на чанк, таймаут 120s
- `/api/files/download/` — стриминг, таймаут 600s
- `/api/` — proxy к backend:3000, лимит 110 МБ, SSE
- `/` — SPA-роутинг (try_files → index.html)

### server/.env

На основе `server/.env.example`. Ключевые значения для production:

```
PORT=3000
CORS_ORIGIN=https://ravek.link
NODE_ENV=production
REDIS_URL=redis://redis:6379
STORAGE_PROVIDER=cloudru
```

Все секреты (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_JWT_SECRET, S3_*, OPENROUTER_API_KEY) заполняются реальными значениями. Файл не коммитится в git.

---

## Первоначальное развертывание

### Шаг 1. Установить Docker (root)

```bash
curl -fsSL https://get.docker.com | sh
systemctl enable docker
systemctl start docker
```

### Шаг 2. Добавить billhub в группу docker (root)

```bash
usermod -aG docker billhub
```

Требуется перелогин пользователя billhub.

### Шаг 3. Клонировать репозиторий (billhub)

```bash
cd /var/www/billhub/data
git clone https://github.com/saztonov/billhub.git billhub-app
cd billhub-app
```

### Шаг 4. Создать server/.env (billhub)

```bash
cp server/.env.example server/.env
chmod 600 server/.env
nano server/.env
```

Заполнить все значения. См. раздел [server/.env](#serverenv).

### Шаг 5. Собрать и запустить Docker (billhub)

```bash
cd /var/www/billhub/data/billhub-app
docker compose build
docker compose up -d
```

### Шаг 6. Проверить контейнеры (billhub)

```bash
docker compose ps
```

Все 3 сервиса должны быть `Up`. Backend — `Up (healthy)`.

```bash
curl -s http://127.0.0.1:3080/ | head -3
curl -s http://127.0.0.1:3080/api/health
```

### Шаг 7. Настроить nginx (root)

См. раздел [Настройка nginx](#настройка-nginx).

### Шаг 8. Проверить (root)

```bash
curl -I https://ravek.link
curl -s https://ravek.link/api/health
```

---

## Настройка nginx

### Конфиг: /etc/nginx/vhosts/billhub/billhub.fvds.ru.conf

Файл содержит 4 блока server:

1. **billhub.fvds.ru HTTP (порт 80)** — proxy к Docker
2. **billhub.fvds.ru HTTPS (порт 443)** — proxy к Docker
3. **ravek.link HTTPS (порт 443)** — proxy к Docker
4. **ravek.link HTTP (порт 80)** — редирект на HTTPS

Блоки 1-3 используют одинаковый location /:

```nginx
        location / {
            proxy_pass http://127.0.0.1:3080;
            proxy_http_version 1.1;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection "upgrade";
            proxy_read_timeout 600s;
            proxy_send_timeout 600s;
            client_max_body_size 110m;
            proxy_buffering off;
        }
```

Блок 4 (ravek.link HTTP) — только редирект:

```nginx
server {
        server_name ravek.link www.ravek.link;
        listen 185.200.179.0:80;
        return 301 https://$host$request_uri;
}
```

### Применение (root)

```bash
nginx -t
systemctl reload nginx
```

---

## Проверка работоспособности

### Базовая (root или billhub)

```bash
curl -I https://ravek.link
curl -s https://ravek.link/api/health
curl -s https://ravek.link/api/health/ready
```

### Память (billhub)

```bash
docker stats --no-stream
free -h
```

### Логи (billhub)

```bash
docker compose logs --tail=50 backend
docker compose logs --tail=50 frontend
docker compose logs --tail=50 redis
```

### В браузере

- Открыть https://ravek.link — загрузка SPA
- Авторизоваться
- Перейти на https://ravek.link/invoices, нажать F5 (SPA-роутинг)
- Загрузить файл, скачать файл

---

## Обновление приложения

### Стандартное обновление (billhub)

```bash
cd /var/www/billhub/data/billhub-app
git pull origin main
docker compose build
docker compose up -d
```

Docker пересоберёт только изменённые образы. Контейнеры без изменений не перезапускаются.

### Обновление только фронтенда (billhub)

```bash
cd /var/www/billhub/data/billhub-app
git pull origin main
docker compose build frontend
docker compose up -d
```

### Обновление только бэкенда (billhub)

```bash
cd /var/www/billhub/data/billhub-app
git pull origin main
docker compose build backend
docker compose up -d
```

### Обновление server/.env (billhub)

```bash
nano /var/www/billhub/data/billhub-app/server/.env
docker compose restart backend
```

Пересборка не нужна — env подключается при запуске контейнера.

### Очистка старых образов (billhub)

После нескольких обновлений накапливаются неиспользуемые образы:

```bash
docker image prune -f
```

---

## Откат

### К предыдущей версии кода (billhub)

```bash
cd /var/www/billhub/data/billhub-app
git log --oneline -5
git checkout <хеш-коммита>
docker compose build
docker compose up -d
```

Вернуться на последнюю версию:

```bash
git checkout main
docker compose build
docker compose up -d
```

### Полный откат на статический SPA

#### (billhub)

```bash
cd /var/www/billhub/data/billhub-app
docker compose down
```

#### (root)

Вернуть в `/etc/nginx/vhosts/billhub/billhub.fvds.ru.conf` блоки `location /` со статикой вместо proxy_pass:

```nginx
        location / {
                location ~* ^.+\.(jpg|jpeg|gif|png|svg|js|css|mp3|ogg|mpe?g|avi|zip|gz|bz2?|rar|swf|webp|woff|woff2)$ {
                        expires 24h;
                        try_files $uri =404;
                }
                try_files $uri $uri/ /index.html;
        }
```

```bash
nginx -t
systemctl reload nginx
```

---

## Полезные команды

### Статус контейнеров (billhub)

```bash
docker compose ps
```

### Логи в реальном времени (billhub)

```bash
docker compose logs -f backend
docker compose logs -f frontend
```

### Перезапуск одного сервиса (billhub)

```bash
docker compose restart backend
docker compose restart frontend
docker compose restart redis
```

### Остановка всех контейнеров (billhub)

```bash
docker compose down
```

### Запуск после остановки (billhub)

```bash
docker compose up -d
```

### Использование ресурсов (billhub)

```bash
docker stats --no-stream
```

### Зайти внутрь контейнера (billhub)

```bash
docker exec -it billhub-app-backend-1 sh
docker exec -it billhub-app-frontend-1 sh
```

### Логи nginx (root)

```bash
tail -f /var/www/httpd-logs/billhub.fvds.ru.access.log
tail -f /var/www/httpd-logs/billhub.fvds.ru.error.log
```

---

**Дата обновления:** 2026-03-31
**Архитектура:** Docker (frontend + backend + redis)
