# Образ бэкенда BillHub (API + worker + migrate — один образ).
#
# ВАЖНО: контекст сборки — КОРЕНЬ РЕПО (а не ./server), потому что в образ нужно положить
# каталог sql/migrations (он лежит в корне, вне ./server). Сборка:
#   docker build -f server/Dockerfile -t billhub-api .
# либо через compose с `context: .` (dev) / `context: ..` (deploy/docker-compose.prod.yml).
#
# Этап 1: Сборка бэкенда (Debian для совместимости node-canvas с g++)
FROM node:20-bookworm-slim AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev libpixman-1-dev \
    && rm -rf /var/lib/apt/lists/*

# Фиксируем npm под версию dev-окружения (11.x). Базовый node:20 несёт npm 10.x,
# а lock генерируется на dev под npm 11.x — из-за разной трактовки optional peer-
# зависимостей (@emnapi/*) строгий `npm ci` ловит мнимый рассинхрон lock и падает.
# Совпадение версий npm в сборке и на dev убирает этот класс поломок.
RUN npm install -g npm@11.6.2

WORKDIR /app

COPY server/package*.json ./
RUN npm ci

COPY server/ ./
RUN npm run build

# Этап 2: Продакшн-образ (Debian slim — совместимость с node-canvas, собранным на glibc)
FROM node:20-bookworm-slim

# Рантайм-зависимости: poppler для рендеринга PDF, шрифты, node-canvas
RUN apt-get update && apt-get install -y --no-install-recommends \
    libcairo2 libpango-1.0-0 libpangocairo-1.0-0 \
    libjpeg62-turbo libgif7 librsvg2-2 libpixman-1-0 \
    poppler-utils \
    wget \
    fonts-dejavu-core fonts-liberation fontconfig \
    && fc-cache -fv \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

# Миграции в образ (C2): нужны и one-shot сервису migrate, и API при production startup checks
# (app.ts → loadMigrationFiles(DEFAULT_MIGRATIONS_DIR)). MIGRATIONS_DIR делает путь явным —
# в собранном dist относительный путь резолвился бы иначе, чем в исходнике.
COPY sql/migrations ./sql/migrations

ENV NODE_ENV=production
ENV MIGRATIONS_DIR=/app/sql/migrations

EXPOSE 3000

# Проверка здоровья сервиса
HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=10s \
    CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "--max-old-space-size=512", "dist/server.js"]
