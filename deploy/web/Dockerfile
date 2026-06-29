# Образ billhub-web: SPA-статика портала за nginx (C1 ownership).
# Контекст сборки — КОРЕНЬ РЕПО:
#   docker build -f deploy/web/Dockerfile -t billhub-web .
# Проксирование /api делает infra-nginx (ingress), поэтому здесь nginx раздаёт ТОЛЬКО статику
# (без /api-локаций) — см. deploy/web/nginx.conf.

# Этап 1: сборка фронтенда
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

# VITE_API_URL пуст ⇒ same-origin (относительный /api). VITE_SENTRY_DSN — задел (§11), по умолчанию пуст.
ARG VITE_API_URL=
ARG VITE_SENTRY_DSN=
RUN npm run build

# Этап 2: раздача статики
FROM nginx:alpine

COPY --from=builder /app/dist /usr/share/nginx/html
COPY deploy/web/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
