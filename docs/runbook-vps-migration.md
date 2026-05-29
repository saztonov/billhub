# Runbook: миграция backend BillHub на другую VPS

Параметризованная процедура переноса backend на любую другую VPS с минимальным downtime. Цель — **≤1 час** при готовых credentials.

**Применимо в Этапе 1** (одна VPS): переезд на другого VPS-провайдера, на VPS с лучшим IP, на VPS в другом регионе и т.д.

**Применимо в Этапе 2** (2 Yandex Compute VM): добавление третьей VM, замена VM, миграция между AZ.

Этот документ — каркас. Конкретные значения (IP, домены, пути секретов) заполняются live при подготовке миграции.

---

## 1. Pre-flight (за 1 день до миграции)

### 1.1 Подготовка целевой VPS

- [ ] Аренда VPS соответствующего размера: 4 vCPU / 8 GB RAM / 50+ GB SSD, Ubuntu LTS 22.04+.
- [ ] **Обязательно: статический публичный IP.** Плавающий IP не подходит — он нужен для allowlist Yandex PG и Cloud.ru S3.
- [ ] SSH-доступ настроен (по ключу, без пароля).
- [ ] Зафиксировать значения для подстановки:
  - `NEW_VPS_IP=___.___.___.___`
  - `NEW_VPS_HOST=user@___.___.___.___`
  - `OLD_VPS_IP=___.___.___.___`
  - `DOMAIN=billhub.ru` (или фактический)

### 1.2 Установка Docker и базовых утилит на NEW_VPS

```bash
ssh "$NEW_VPS_HOST" '
  sudo apt-get update
  sudo apt-get install -y ca-certificates curl gnupg lsb-release ufw fail2ban git
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list
  sudo apt-get update
  sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
  sudo usermod -aG docker $USER
'
```

- [ ] Перелогиниться, проверить `docker compose version`.

### 1.3 Файерволл и базовая безопасность

```bash
ssh "$NEW_VPS_HOST" '
  sudo ufw allow OpenSSH
  sudo ufw allow 80/tcp
  sudo ufw allow 443/tcp
  sudo ufw --force enable
  sudo systemctl enable --now fail2ban
'
```

### 1.4 Создание структуры каталогов

```bash
ssh "$NEW_VPS_HOST" '
  sudo mkdir -p /opt/portals/billhub /opt/portals/billhub/data /opt/portals/billhub/logs
  sudo chown -R $USER:$USER /opt/portals/billhub
'
```

### 1.5 Allowlist на внешних сервисах

- [ ] **Yandex Managed PostgreSQL:** Yandex Cloud Console → Managed Service for PostgreSQL → cluster → Hosts → Edit security → добавить `NEW_VPS_IP/32` в whitelist.
- [ ] **Cloud.ru S3:** Cloud.ru Console → Object Storage → Bucket → Permissions → добавить `NEW_VPS_IP/32` в allowlist (если используется IP-restriction; иначе — пропустить).
- [ ] **OpenRouter:** обычно не требует allowlist (auth по токену). Если используется IP-restriction — добавить.
- [ ] **OLD_VPS_IP пока НЕ удаляем** — он понадобится для fallback.

---

## 2. Установка приложения на NEW_VPS

### 2.1 Clone репозитория

```bash
ssh "$NEW_VPS_HOST" '
  cd /opt/portals/billhub
  git clone https://github.com/<org>/billhub.git .
  git checkout <release-tag>          # например, v1.5.0 или конкретный SHA
'
```

### 2.2 Подложить `.env`

Файл `.env` на NEW_VPS отличается от OLD_VPS только статическим IP-зависимыми параметрами. Большинство значений переносится 1-в-1 из OLD_VPS.

```bash
# 1. Снять .env со старой VPS (в зашифрованный канал)
scp "$OLD_VPS_HOST:/opt/portals/billhub/.env" /tmp/billhub.env

# 2. (опционально) править IP-чувствительные значения
#    Большинство значений — DNS и не меняются.

# 3. Положить на NEW_VPS с правами 600
scp /tmp/billhub.env "$NEW_VPS_HOST:/opt/portals/billhub/.env"
ssh "$NEW_VPS_HOST" 'chmod 600 /opt/portals/billhub/.env'

# 4. Очистить локальную копию
shred -u /tmp/billhub.env
```

**Чек-лист `.env` (текущая инвентаризация — см. [migration-inventory.md §8](migration-inventory.md)):**

- [ ] `DATABASE_URL` — DNS endpoint Yandex PG (НЕ меняется).
- [ ] `DATABASE_MIGRATION_URL` — то же.
- [ ] `STORAGE_PROVIDER=cloudru` — то же.
- [ ] `S3_ENDPOINT=https://s3.cloud.ru` — DNS, не меняется.
- [ ] `S3_ACCESS_KEY`, `S3_SECRET_KEY` — credentials, не меняются.
- [ ] `OPENROUTER_API_KEY` — не меняется.
- [ ] `REDIS_URL=redis://redis:6379` — внутренний адрес compose, не меняется.
- [ ] `JWT_*` — секреты, не меняются.
- [ ] `CORS_ORIGIN=https://billhub.ru` — не меняется.

### 2.3 Загрузка образов / build

**Этап 1 (нет Container Registry):** локальный build на VPS.

```bash
ssh "$NEW_VPS_HOST" '
  cd /opt/portals/billhub
  docker compose build
'
```

**Этап 2 (есть Yandex Container Registry):** pull.

```bash
ssh "$NEW_VPS_HOST" '
  cd /opt/portals/billhub
  echo "$YC_OAUTH_TOKEN" | docker login --username oauth --password-stdin cr.yandex
  docker compose pull
'
```

### 2.4 Подготовить Redis volume (опционально)

Если требуется сохранить in-flight BullMQ jobs из OLD_VPS:

```bash
# На OLD_VPS
ssh "$OLD_VPS_HOST" 'docker compose exec redis redis-cli SAVE && docker cp $(docker compose ps -q redis):/data/dump.rdb /tmp/redis-dump.rdb'
scp "$OLD_VPS_HOST:/tmp/redis-dump.rdb" /tmp/

# На NEW_VPS
scp /tmp/redis-dump.rdb "$NEW_VPS_HOST:/tmp/"
ssh "$NEW_VPS_HOST" '
  mkdir -p /opt/portals/billhub/data/redis
  cp /tmp/redis-dump.rdb /opt/portals/billhub/data/redis/dump.rdb
'
```

В большинстве случаев потеря in-flight jobs допустима (они будут пере-подняты при следующем триггере), и этот шаг можно пропустить.

### 2.5 Поднятие compose

```bash
ssh "$NEW_VPS_HOST" '
  cd /opt/portals/billhub
  docker compose up -d
'
```

### 2.6 Дождаться `/health/ready`

```bash
for i in {1..60}; do
  status=$(curl -s -o /dev/null -w "%{http_code}" "http://$NEW_VPS_IP/api/health/ready")
  if [ "$status" = "200" ]; then echo "Ready"; break; fi
  sleep 2
done
```

Если не дождались — диагностика:
- `ssh "$NEW_VPS_HOST" 'docker compose logs --tail=200 backend'`
- Проверить `/api/health/ready` JSON-тело (per-dependency статусы).

---

## 3. Cutover (DNS switch)

### 3.1 Снижение TTL (за 48 часов до cutover, ОДИН раз)

```bash
# В DNS-провайдере (Cloudflare/Selectel/etc.)
# A-запись billhub.ru: TTL → 60 seconds
```

### 3.2 Смена A-записи

```bash
# В DNS-провайдере
# A-запись billhub.ru: IP → $NEW_VPS_IP
```

- [ ] Дождаться propagation: `dig +short billhub.ru @8.8.8.8` должен вернуть `$NEW_VPS_IP`. Обычно 30–120 с.
- [ ] Проверить из нескольких регионов (например, через `https://www.whatsmydns.net/`).

### 3.3 Smoke в production

- [ ] Логин под admin/user/counterparty_user/security.
- [ ] Создание тестовой заявки, загрузка файла.
- [ ] OCR-задача проходит.
- [ ] Согласование РП.

### 3.4 Удаление OLD_VPS_IP из allowlist (через 30+ дней)

- [ ] Через 30 дней после успешного cutover убедиться, что OLD_VPS не нужен → удалить `OLD_VPS_IP/32` из allowlist Yandex PG, Cloud.ru S3, OpenRouter.
- [ ] Погасить OLD_VPS или переиспользовать.

---

## 4. Rollback (если NEW_VPS не работает)

### 4.1 Если NEW_VPS не отвечает на `/health/ready`

- [ ] DNS-switch НЕ делать.
- [ ] Разобраться в проблеме на NEW_VPS в спокойном режиме.

### 4.2 Если DNS-switch уже сделан, и есть проблемы

- [ ] Вернуть A-запись на `$OLD_VPS_IP` (TTL 60 с).
- [ ] Дождаться propagation.
- [ ] Smoke на OLD_VPS.

OLD_VPS остаётся работоспособным до момента, когда он не нужен — никаких разрушающих действий на нём не делается во время миграции.

---

## 5. Что точно стоит в Этапе 2 (предварительно)

В Этапе 2 эта процедура используется для:
- Подъёма 2 backend VM с нуля (вместе с Terraform → vmctl → compose-сервисы).
- Замены вышедшей из строя VM в ALB (выводится из target group → новая VM поднимается → возвращается в TG).
- Миграции между AZ.

Дополнительные шаги для Этапа 2 (TBD при имплементации):

- [ ] Pull образов из Yandex Container Registry (см. §2.3).
- [ ] Чтение секретов из Yandex Lockbox через IAM service account на VM (вместо `.env`).
- [ ] Регистрация VM в target group Yandex ALB.
- [ ] Установка Node Exporter, cAdvisor для Managed Prometheus.
- [ ] Установка лог-агента для Cloud Logging.

---

## 6. Связанные документы

- [docs/adr/0001-deviations-from-corp-standard.md](adr/0001-deviations-from-corp-standard.md)
- [docs/migration-inventory.md](migration-inventory.md)
- [docs/migration-cutover.md](migration-cutover.md)
