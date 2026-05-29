# ADR-0001: Отклонения от корпоративного стандарта v3

**Status:** accepted (2026-05-30)

## Context

Корпоративный стандарт v3 ([temp/corp_standard_full.md](../../temp/corp_standard_full.md)) описывает целевую архитектуру: 2 backend VM в Yandex Compute + Application Load Balancer + Keycloak + AD federation + Yandex Managed PostgreSQL + Cloud.ru S3 + Yandex Lockbox + Sentry + Managed Prometheus + Cloud Logging.

Текущее состояние BillHub существенно проще: 1 VPS + Supabase Cloud + Cloudflare R2. Прямой переход к полному стандарту v3 в один cutover создаёт неприемлемый риск: одновременная смена инфраструктуры, БД, identity-провайдера, файлового хранилища и фронт-флоу.

Программа миграции разбита на два этапа. Этап 1 — production-ready минимум на собственной инфраструктуре. Этап 2 — полный переход к стандарту v3. Между ними допустимы недели или месяцы стабилизации.

Этот документ фиксирует, в каких пунктах Этап 1 отклоняется от стандарта v3 и почему. Этап 2 устраняет большинство отклонений.

## Decision

### Этап 1 (production-ready минимум) — допустимые отклонения от стандарта v3

| Компонент стандарта v3 | Решение Этапа 1 | Обоснование |
|---|---|---|
| 2 backend VM в Yandex Compute (раздел 4) | 1 новая VPS (не Yandex), backend на ней же | Цель Этапа 1 — получить рабочее решение на собственной инфре. 2 VM + ALB — отдельная инфраструктурная работа, которая входит в Этап 2. На текущей нагрузке (десятки одновременных пользователей) 1 VPS достаточно. |
| Yandex Application Load Balancer (раздел 3) | nginx на той же VPS | См. выше. Frontend и backend на одной машине, TLS termination — nginx. |
| Keycloak SSO (раздел 9) | Standalone auth по разделу 13 (cookie + JWT + refresh rotation + reuse detection) | Раздел 13 стандарта прямо допускает standalone auth для порталов, не подключённых к Keycloak. Текущий auth уже близок к этому — доводим до полного соответствия разделу 13. |
| Active Directory federation (раздел 10) | Не делается | Без Keycloak неприменимо. Этап 2. |
| Yandex Container Registry, immutable image tags (раздел 19) | Локальный build на новой VPS из git tag | Этап 2 добавляет CR + deployment runner. В Этапе 1 — простой workflow (clone + build + up). |
| Yandex Lockbox (раздел 18) | `.env` файл с правами 600 на новой VPS | Lockbox внедряется в Этапе 2 вместе с CR и deployment runner. |
| Sentry SaaS (раздел 20) | `error_logs` таблица + `logError()` (как сейчас) + расширенный pino redaction | Базовая телеметрия ошибок уже есть. Sentry — Этап 2. |
| Yandex Managed Prometheus (раздел 20) | Не делается; минимальные алерты через external uptime monitoring (UptimeRobot) + cron-проверки | Полный Prometheus — Этап 2. В Этапе 1 покрываем `/health/live`, `/health/ready`, dead jobs, DB connections, S3 error rate. |
| Yandex Cloud Logging (раздел 20) | docker logging driver → файлы на VPS + Pino stdout | Полное Cloud Logging — Этап 2. |
| Email provider (раздел 17) | Абстракция `@su10/mail` с заглушкой | Email-провайдера ещё нет. План вводит абстракцию, чтобы реальное подключение SES/Postbox в будущем было заменой одного модуля. |
| PostgreSQL-jobs для очередей (раздел 16) | BullMQ + Redis сохраняются | Стандарт раздел 16 прямо допускает Redis/BullMQ для случаев, когда PG-jobs недостаточны: chunked upload uses Redis sessions с TTL; IO-bound OCR пайплайн. Снос — работа на пустом месте на критическом пути cutover. |
| Drizzle Kit миграции (раздел 8) | SQL-first режим — см. [ADR-0002](0002-sql-first-drizzle.md) | Соответствует стандарту, но требует уточнения процесса. |

### Этап 2 (корпоративный стандарт v3) — допустимые отклонения

| Компонент | Решение Этапа 2 | Обоснование |
|---|---|---|
| Keycloak в отдельных VM | Keycloak co-located на тех же 2 backend VM в отдельном compose-проекте `/opt/infra/keycloak/` | Стандарт раздел 9 говорит «Keycloak не размещается внутри compose-проектов порталов» — это соблюдено (отдельный compose-проект, отдельные `.env`, отдельные backup, отдельный runbook). Отдельные VM стандарт прямо НЕ требует. На текущей нагрузке выделение отдельных VM под Keycloak — избыточно. Deploy BillHub не должен рестартовать Keycloak. |
| Frontend на отдельной площадке | Frontend nginx остаётся на VPS Этапа 1, проксирует `/api/*` через ALB | Стандарт говорит про «2 backend VM», не про «2 машины всего». Frontend nginx может остаться где угодно; перенос на Yandex Object Storage + CDN — отдельный микро-cutover, не блокирующий Этап 2. |
| Redis | Сохраняется (см. Этап 1 выше) | На 2 VM требует sticky session на ALB по `upload_id` либо общей Redis-инстанции либо Redis Sentinel/Cluster — выбор фиксируется отдельным ADR в Этапе 2. |

## Consequences

**Плюсы:**
- Этап 1 ставится в реалистичные сроки (10 итераций cutover-critical + 3 quality-hardening), достижим без покупки 2 Yandex VM, без Keycloak/AD-инфраструктуры и без email-провайдера.
- Этап 2 — независимый шаг; до него можно дойти, когда команда и бюджет готовы, без дополнительной миграции данных.
- Сохранение Redis убирает работу с критического пути и не противоречит стандарту.
- Standalone auth (раздел 13) — стандарт-compliant; пользователи логинятся прежними bcrypt-паролями (импорт из `auth.users.encrypted_password`).

**Минусы:**
- После Этапа 1 портал НЕ имеет: SSO, AD федерации, ALB HA, иммутабельных образов в Registry, Lockbox, Sentry, Managed Prometheus, transactional email.
- Часть отклонений (Sentry, Lockbox, CI/CD pipeline с rolling deploy) переносится на Этап 2 — это техдолг, явно фиксируемый.
- Keycloak co-located на 2 backend VM в Этапе 2 — компромисс; деплой BillHub и Keycloak должны быть строго разделены, иначе риск кросс-рестартов.

## Alternatives

- **Прямой переход к стандарту v3 в один cutover** — отвергнут как высокорискованный (одновременная смена 5+ компонентов, без email-канала массовый сброс паролей подрядчиков невозможен, без AD VPN не запустить сотрудников).
- **Standalone auth навсегда (без Этапа 2)** — приемлемо, если SSO не понадобится. Стандарт v3 это допускает. Возможный финальный финиш программы.
- **Сразу 2 backend VM в Yandex без Keycloak в Этапе 1** — добавляет инфраструктурную сложность без принципиальной пользы; ALB и HA-настройка нужны вместе с identity-сменой.
- **Снос Redis в Этапе 1** — отвергнут: chunked upload и BullMQ работают на Redis нативно; PG-эмуляция требует новой таблицы + watchdog + переписать 3 критичных пути одновременно с миграцией БД.
