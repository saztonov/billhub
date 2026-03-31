# Этап 1: Сборка бэкенда
FROM node:20-alpine AS builder

# Нативные зависимости для сборки node-canvas
RUN apk add --no-cache python3 make g++ cairo-dev pango-dev libjpeg-turbo-dev giflib-dev librsvg-dev pixman-dev

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# Этап 2: Продакшн-образ
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
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1

CMD ["node", "--max-old-space-size=512", "dist/server.js"]
