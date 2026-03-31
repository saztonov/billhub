# Этап 1: Сборка бэкенда (Debian для совместимости node-canvas с g++)
FROM node:20-bookworm-slim AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev libpixman-1-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# Этап 2: Продакшн-образ (Alpine для минимального размера)
FROM node:20-alpine

# Нативные зависимости для node-canvas (рендеринг PDF в OCR-процессе)
RUN apk add --no-cache cairo pango libjpeg-turbo giflib librsvg pixman

WORKDIR /app

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

ENV NODE_ENV=production

EXPOSE 3000

# Проверка здоровья сервиса
HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=10s \
    CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "--max-old-space-size=512", "dist/server.js"]
