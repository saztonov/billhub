# Архитектура развертывания BillHub на VPS

## Оглавление
1. [Обзор](#обзор)
2. [Системные требования](#системные-требования)
3. [Архитектура решения](#архитектура-решения)
4. [Структура файлов](#структура-файлов)
5. [Процесс развертывания](#процесс-развертывания)
6. [Настройка nginx](#настройка-nginx)
7. [Проверка работоспособности](#проверка-работоспособности)
8. [Обновление приложения](#обновление-приложения)
9. [Список команд для развертывания](#список-команд-для-развертывания)

---

## Обзор

BillHub - это Single Page Application (SPA) на React 19 + Vite + TypeScript, которое развертывается как статический сайт на VPS с ISPmanager.

**Ключевые особенности архитектуры:**
- Нет собственного backend-сервера на VPS
- Все API-запросы идут в облачные сервисы (Supabase, Cloud.ru S3, OpenRouter.ai)
- Статические файлы раздаются через nginx
- SSL-сертификат Let's Encrypt для HTTPS
- pm2 НЕ используется (статический деплой)

---

## Системные требования

### Сервер
- **ОС:** Linux (Ubuntu/Debian рекомендуется)
- **Node.js:** v18.0.0 или выше (рекомендуется v20.x LTS)
- **npm:** v9.0.0 или выше
- **nginx:** v1.18.0 или выше
- **ISPmanager:** любая актуальная версия
- **Git:** для клонирования репозитория

### Пользователи и права
- **root:** для установки системных пакетов, настройки nginx
- **billhub:** пользователь для работы с приложением и файлами сайта

### Сетевые требования
- **Исходящий HTTPS к:**
  - `https://*.supabase.co` - Supabase API
  - `https://*.cloud.ru` - Cloud.ru S3
  - `https://openrouter.ai` - OpenRouter Vision API
- **Входящий HTTP/HTTPS:** порты 80, 443 для nginx

---

## Архитектура решения

### Схема компонентов

```
┌─────────────────────────────────────────────────────────────┐
│                         КЛИЕНТ                              │
│                  (Браузер пользователя)                     │
└────────────────────────┬────────────────────────────────────┘
                         │ HTTPS (443)
                         │
┌────────────────────────▼────────────────────────────────────┐
│                    VPS: billhub.fvds.ru                     │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │              nginx (веб-сервер)                        │ │
│  │  - SSL-терминация (Let's Encrypt)                     │ │
│  │  - Раздача статики из /var/www/                       │ │
│  │  - SPA роутинг (try_files → index.html)               │ │
│  └─────────────────────┬──────────────────────────────────┘ │
│                        │                                     │
│  ┌─────────────────────▼──────────────────────────────────┐ │
│  │   /var/www/billhub/data/www/billhub.fvds.ru/          │ │
│  │   - index.html                                         │ │
│  │   - assets/index-[hash].js                             │ │
│  │   - assets/index-[hash].css                            │ │
│  │   - assets/pdf.worker.min-[hash].mjs                   │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │   /home/billhub/billhub-app/  (рабочая директория)    │ │
│  │   - src/            (исходники)                        │ │
│  │   - dist/           (собранное приложение)             │ │
│  │   - .env            (переменные окружения)             │ │
│  │   - node_modules/   (зависимости)                      │ │
│  └────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
                         │
                         │ HTTPS (исходящий)
                         │
        ┌────────────────┼────────────────┐
        │                │                │
        ▼                ▼                ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│   Supabase   │  │  Cloud.ru S3 │  │  OpenRouter  │
│  (Database)  │  │  (Storage)   │  │    (OCR)     │
│    (Auth)    │  │              │  │              │
└──────────────┘  └──────────────┘  └──────────────┘
```

### Поток данных

1. **Загрузка приложения:**
   ```
   Клиент → nginx → /var/www/.../index.html + assets/
   ```

2. **API-запросы:**
   ```
   Клиент → Supabase API (облако)
   ```

3. **Загрузка/скачивание файлов:**
   ```
   Клиент → Cloud.ru S3 (presigned URLs)
   ```

4. **OCR-распознавание:**
   ```
   Клиент → OpenRouter.ai API (облако)
   ```

### Жизненный цикл развертывания

```
GitHub (исходный код)
    ↓ git clone (billhub)
/home/billhub/billhub-app/
    ↓ npm install (billhub)
node_modules/
    ↓ npm run build (billhub)
dist/ (~3.1 МБ)
    ↓ cp dist/* (root/sudo)
/var/www/billhub/data/www/billhub.fvds.ru/
    ↓ chown/chmod (root/sudo)
Права доступа billhub:billhub 755
    ↓ nginx reload (root/sudo)
Приложение доступно на https://billhub.fvds.ru
```

---

## Структура файлов

### Рабочая директория (/home/billhub/billhub-app/)

```
billhub-app/
├── src/                          # Исходный код (не используется в production)
│   ├── pages/                    # Страницы-роуты
│   ├── components/               # UI-компоненты
│   ├── services/                 # API-сервисы
│   ├── store/                    # Zustand stores
│   └── main.tsx                  # Точка входа
├── dist/                         # Production build (генерируется npm run build)
│   ├── index.html
│   └── assets/
│       ├── index-[hash].js       # ~2.8 МБ (минифицирован)
│       ├── index-[hash].css
│       └── pdf.worker.min-[hash].mjs
├── node_modules/                 # Зависимости npm (~500+ пакетов)
├── .env                          # Переменные окружения (НЕ коммитится в Git)
├── package.json                  # Манифест проекта
├── vite.config.ts                # Конфигурация сборки
└── tsconfig.json                 # Конфигурация TypeScript
```

### Production-директория (/var/www/billhub/data/www/billhub.fvds.ru/)

```
billhub.fvds.ru/
├── index.html                    # Точка входа SPA (2 КБ)
├── assets/
│   ├── index-[hash].js           # Основной бандл JavaScript
│   ├── index-[hash].css          # Стили
│   └── pdf.worker.min-[hash].mjs # PDF.js worker
└── vite.svg                      # Favicon
```

**Владелец:** billhub:billhub
**Права:** 755 (чтение и выполнение для всех, запись только владельцу)

---

## Процесс развертывания

### Этап 1: Подготовка окружения

Установка Node.js 20.x LTS (если не установлен):

```bash
# Пользователь: root
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
apt-get install -y nodejs
```

Проверка установки:

```bash
# Пользователь: root или billhub
node --version   # должно вывести v20.x.x
npm --version    # должно вывести v10.x.x
```

### Этап 2: Клонирование репозитория

```bash
# Пользователь: billhub
cd /home/billhub
git clone https://github.com/ваш-username/billhub.git billhub-app
cd billhub-app
```

**Для приватного репозитория:**
- Настройте SSH-ключ или GitHub Personal Access Token
- Или используйте HTTPS с токеном: `git clone https://TOKEN@github.com/user/repo.git`

### Этап 3: Установка зависимостей

```bash
# Пользователь: billhub
npm install
```

Устанавливается ~500+ пакетов, займет 2-5 минут.

### Этап 4: Настройка переменных окружения

```bash
# Пользователь: billhub
nano .env
```

Содержимое `.env`:

```env
# Supabase (база данных + аутентификация)
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY=your-publishable-key
VITE_SUPABASE_TENANT_ID=your-tenant-id

# Cloud.ru S3 (хранилище файлов)
VITE_S3_ENDPOINT=https://your-endpoint.cloud.ru
VITE_S3_REGION=ru-msk
VITE_S3_ACCESS_KEY=your-access-key
VITE_S3_SECRET_KEY=your-secret-key
VITE_S3_BUCKET=your-bucket-name

# OpenRouter.ai (OCR-распознавание)
VITE_OPENROUTER_API_KEY=your-openrouter-api-key
```

**Важно:** переменные встраиваются в бандл при сборке, изменение `.env` требует пересборки.

### Этап 5: Сборка production-версии

```bash
# Пользователь: billhub
npm run build
```

Процесс сборки:
1. TypeScript компиляция (`tsc -b`)
2. Vite сборка с минификацией
3. Генерация директории `dist/`

Проверка результата:

```bash
# Пользователь: billhub
ls -lh dist/
```

Должны увидеть `index.html`, `assets/`, `vite.svg`.

### Этап 6: Копирование в production-директорию

```bash
# Пользователь: root (через sudo)
rm -rf /var/www/billhub/data/www/billhub.fvds.ru/*
cp -r /home/billhub/billhub-app/dist/* /var/www/billhub/data/www/billhub.fvds.ru/
```

Установка прав доступа:

```bash
# Пользователь: root (через sudo)
chown -R billhub:billhub /var/www/billhub/data/www/billhub.fvds.ru/
chmod -R 755 /var/www/billhub/data/www/billhub.fvds.ru/
```

---

## Настройка nginx

### Конфигурация для SPA

ISPmanager автоматически создает конфигурацию при добавлении сайта. Файл обычно находится в `/etc/nginx/vhosts/billhub.conf`.

**Найти конфигурационный файл:**

```bash
# Пользователь: root
ls -la /etc/nginx/vhosts/
# или
grep -r "billhub.fvds.ru" /etc/nginx/
```

**Необходимая конфигурация:**

```nginx
server {
    listen 443 ssl http2;
    server_name billhub.fvds.ru www.billhub.fvds.ru;

    # SSL-сертификаты (настроены через ISPmanager + Let's Encrypt)
    ssl_certificate /var/www/httpd-cert/billhub/billhub.fvds.ru.crtca;
    ssl_certificate_key /var/www/httpd-cert/billhub/billhub.fvds.ru.key;

    # Корневая директория
    root /var/www/billhub/data/www/billhub.fvds.ru;
    index index.html;

    # КРИТИЧНО для SPA: все запросы отдают index.html для React Router
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Кеширование статических ресурсов
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # Логи
    access_log /var/log/nginx/billhub.fvds.ru.access.log;
    error_log /var/log/nginx/billhub.fvds.ru.error.log;
}

# Редирект с HTTP на HTTPS
server {
    listen 80;
    server_name billhub.fvds.ru www.billhub.fvds.ru;
    return 301 https://$host$request_uri;
}
```

**Ключевая директива для SPA:**

```nginx
location / {
    try_files $uri $uri/ /index.html;
}
```

Это обеспечивает:
- Прямые ссылки работают (`https://billhub.fvds.ru/invoices`)
- Обновление страницы (F5) не дает 404
- React Router корректно обрабатывает все маршруты

### Применение конфигурации

```bash
# Пользователь: root
# Проверка синтаксиса
nginx -t

# Мягкий перезапуск (без разрыва соединений)
systemctl reload nginx

# Или полный перезапуск
systemctl restart nginx

# Проверка статуса
systemctl status nginx
```

### Важно: ISPmanager и nginx

ISPmanager может автоматически перезаписывать конфигурацию nginx при изменениях через веб-интерфейс.

**Решение:**
1. Добавьте директивы через ISPmanager → "Дополнительные директивы nginx"
2. Или пересоздавайте конфигурацию после изменений в ISPmanager

---

## Проверка работоспособности

### 1. Проверка через curl (на сервере)

```bash
# Пользователь: billhub или root
# Проверка HTTP-статуса
curl -I https://billhub.fvds.ru

# Ожидается: HTTP/2 200

# Проверка содержимого
curl https://billhub.fvds.ru | grep "<title>"

# Ожидается: <title>BillHub</title>
```

### 2. Проверка в браузере

**Доступность:**
- Откройте `https://billhub.fvds.ru`
- Проверьте валидность SSL (замок в адресной строке)
- Главная страница должна загрузиться

**React Router:**
- Откройте напрямую `https://billhub.fvds.ru/invoices` (или другой роут)
- Должна загрузиться страница, а не 404
- Нажмите F5 - страница перезагрузится корректно
- Используйте кнопку "Назад" - навигация работает

**DevTools (F12):**
- Console: не должно быть критических ошибок (красных)
- Network: все запросы к `/assets/*` возвращают 200 OK
- Network: проверьте что переменные окружения подставлены (запросы идут на правильные Supabase/S3 URL)

### 3. Проверка интеграций

**Supabase (Auth + DB):**
- Попробуйте авторизоваться
- Если успешно - подключение работает

**Cloud.ru S3:**
- Загрузите тестовый счет
- Если файл сохранился - S3 работает

**OpenRouter OCR:**
- Загрузите счет с изображением
- Если распознался - OCR API работает

### 4. Проверка логов nginx

```bash
# Пользователь: root
# Мониторинг запросов в реальном времени
tail -f /var/log/nginx/billhub.fvds.ru.access.log

# Просмотр ошибок
tail -f /var/log/nginx/billhub.fvds.ru.error.log
```

### 5. Тестирование на разных устройствах

- Desktop (Chrome, Firefox, Safari)
- Mobile (iOS Safari, Android Chrome)
- Tablet

Убедитесь в корректности responsive-дизайна.

---

## Обновление приложения

### Процесс обновления после изменений в коде

```bash
# 1. Подключиться к серверу (PuTTY)

# 2. Перейти в рабочую директорию
# Пользователь: billhub
cd /home/billhub/billhub-app

# 3. Получить последние изменения из GitHub
# Пользователь: billhub
git pull

# 4. Установить новые зависимости (если package.json изменился)
# Пользователь: billhub
npm install

# 5. Обновить .env (если были изменения переменных)
# Пользователь: billhub
nano .env

# 6. Пересобрать проект
# Пользователь: billhub
npm run build

# 7. Скопировать обновленные файлы
# Пользователь: root (через sudo)
sudo rm -rf /var/www/billhub/data/www/billhub.fvds.ru/*
sudo cp -r dist/* /var/www/billhub/data/www/billhub.fvds.ru/

# 8. Установить права (если нужно)
# Пользователь: root (через sudo)
sudo chown -R billhub:billhub /var/www/billhub/data/www/billhub.fvds.ru/

# 9. Перезагрузить nginx (опционально, для очистки кеша)
# Пользователь: root (через sudo)
sudo systemctl reload nginx

# 10. Проверить работоспособность
# Пользователь: billhub или root
curl -I https://billhub.fvds.ru
```

### Автоматизация обновления (скрипт)

Можно создать скрипт для автоматизации обновления:

```bash
# Создание скрипта
# Пользователь: billhub
nano /home/billhub/deploy.sh
```

Содержимое `deploy.sh`:

```bash
#!/bin/bash
set -e

echo "=== Обновление BillHub ==="

cd /home/billhub/billhub-app

echo "[1/6] Git pull..."
git pull

echo "[2/6] npm install..."
npm install

echo "[3/6] npm run build..."
npm run build

echo "[4/6] Копирование файлов..."
sudo rm -rf /var/www/billhub/data/www/billhub.fvds.ru/*
sudo cp -r dist/* /var/www/billhub/data/www/billhub.fvds.ru/

echo "[5/6] Установка прав..."
sudo chown -R billhub:billhub /var/www/billhub/data/www/billhub.fvds.ru/

echo "[6/6] Перезагрузка nginx..."
sudo systemctl reload nginx

echo "=== Готово! ==="
echo "Проверьте: https://billhub.fvds.ru"
```

Сделать скрипт исполняемым:

```bash
# Пользователь: billhub
chmod +x /home/billhub/deploy.sh
```

Использование:

```bash
# Пользователь: billhub
/home/billhub/deploy.sh
```

---

## Список команд для развертывания

### Полный список команд с указанием пользователя

#### Подготовка окружения

```bash
# === Проверка Node.js ===
# Пользователь: billhub (или root)
node --version
npm --version

# === Установка Node.js 20.x LTS (если нужно) ===
# Пользователь: root
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

# === Проверка после установки ===
# Пользователь: billhub (или root)
node --version
npm --version
```

#### Клонирование репозитория

```bash
# === Переход в домашнюю директорию ===
# Пользователь: billhub
cd /home/billhub

# === Клонирование репозитория ===
# Пользователь: billhub
git clone https://github.com/ваш-username/billhub.git billhub-app

# === Переход в директорию проекта ===
# Пользователь: billhub
cd billhub-app
```

#### Установка зависимостей

```bash
# === Установка npm пакетов ===
# Пользователь: billhub
npm install
```

#### Создание .env файла

```bash
# === Создание .env ===
# Пользователь: billhub
nano .env

# Вставьте содержимое:
# VITE_SUPABASE_URL=...
# VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY=...
# VITE_OPENROUTER_API_KEY=...
# VITE_SUPABASE_TENANT_ID=...
# VITE_S3_ENDPOINT=...
# VITE_S3_REGION=...
# VITE_S3_ACCESS_KEY=...
# VITE_S3_SECRET_KEY=...
# VITE_S3_BUCKET=...
#
# Сохранение: Ctrl+O, Enter
# Выход: Ctrl+X
```

#### Сборка проекта

```bash
# === Запуск production-сборки ===
# Пользователь: billhub
npm run build

# === Проверка результата ===
# Пользователь: billhub
ls -lh dist/
```

#### Копирование в production-директорию

```bash
# === Очистка старой версии ===
# Пользователь: root
rm -rf /var/www/billhub/data/www/billhub.fvds.ru/*

# === Копирование собранных файлов ===
# Пользователь: root
cp -r /home/billhub/billhub-app/dist/* /var/www/billhub/data/www/billhub.fvds.ru/

# === Установка правильных прав доступа ===
# Пользователь: root
chown -R billhub:billhub /var/www/billhub/data/www/billhub.fvds.ru/
chmod -R 755 /var/www/billhub/data/www/billhub.fvds.ru/

# === Проверка скопированных файлов ===
# Пользователь: billhub (или root)
ls -lh /var/www/billhub/data/www/billhub.fvds.ru/
```

#### Настройка nginx

```bash
# === Поиск конфигурационного файла ===
# Пользователь: root
ls -la /etc/nginx/vhosts/
# или
grep -r "billhub.fvds.ru" /etc/nginx/

# === Редактирование конфигурации ===
# Пользователь: root
nano /etc/nginx/vhosts/billhub.conf

# Найдите блок location / и убедитесь что содержит:
# location / {
#     root /var/www/billhub/data/www/billhub.fvds.ru;
#     index index.html;
#     try_files $uri $uri/ /index.html;
# }
#
# Сохранение: Ctrl+O, Enter
# Выход: Ctrl+X

# === Проверка корректности конфигурации ===
# Пользователь: root
nginx -t

# === Перезапуск nginx ===
# Пользователь: root
systemctl reload nginx
# или полный перезапуск:
# systemctl restart nginx

# === Проверка статуса nginx ===
# Пользователь: root
systemctl status nginx
```

#### Проверка работоспособности

```bash
# === Проверка HTTP-статуса ===
# Пользователь: billhub (или root)
curl -I https://billhub.fvds.ru

# === Проверка содержимого ===
# Пользователь: billhub (или root)
curl https://billhub.fvds.ru | grep "<title>"

# === Просмотр логов доступа (в реальном времени) ===
# Пользователь: root
tail -f /var/log/nginx/billhub.fvds.ru.access.log

# === Просмотр логов ошибок ===
# Пользователь: root
tail -f /var/log/nginx/billhub.fvds.ru.error.log
```

#### Обновление приложения (после изменений в коде)

```bash
# === Переход в рабочую директорию ===
# Пользователь: billhub
cd /home/billhub/billhub-app

# === Получение последних изменений ===
# Пользователь: billhub
git pull

# === Установка зависимостей (если package.json изменился) ===
# Пользователь: billhub
npm install

# === Обновление .env (если нужно) ===
# Пользователь: billhub
nano .env

# === Пересборка проекта ===
# Пользователь: billhub
npm run build

# === Копирование обновленных файлов ===
# Пользователь: root
rm -rf /var/www/billhub/data/www/billhub.fvds.ru/*
cp -r /home/billhub/billhub-app/dist/* /var/www/billhub/data/www/billhub.fvds.ru/

# === Установка прав (если нужно) ===
# Пользователь: root
chown -R billhub:billhub /var/www/billhub/data/www/billhub.fvds.ru/

# === Перезагрузка nginx ===
# Пользователь: root
systemctl reload nginx

# === Проверка ===
# Пользователь: billhub (или root)
curl -I https://billhub.fvds.ru
```

---

## Примечания

### Безопасность

1. **.env файл** должен находиться ТОЛЬКО в `/home/billhub/billhub-app/`, НЕ в `/var/www/`
2. **Переменные окружения** встраиваются в бандл на этапе сборки (публичные ключи, endpoint'ы)
3. **Права доступа:** убедитесь что файлы в `/var/www/` имеют правильного владельца и права

### ISPmanager

- ISPmanager может автоматически регенерировать конфигурацию nginx
- Если настройки сбрасываются - используйте "Дополнительные директивы nginx" в панели ISPmanager

### Git credentials

- Для приватного репозитория настройте SSH-ключ или Personal Access Token
- Или используйте HTTPS с токеном: `git clone https://TOKEN@github.com/user/repo.git`

### pm2

- pm2 НЕ используется для BillHub (статический деплой)
- pm2 установлен на сервере для других проектов, но для этого приложения не требуется

---

**Дата создания документа:** 2026-02-14
**Версия:** 1.0
