---
name: estimat-integration
description: >-
  Сторона BillHub интеграции EstiMat ↔ BillHub (заявки на оплату по РП, путь 1 own_supplier).
  Использовать при реализации/отладке: входящего сервисного API BillHub /api/external/v1
  (references, import-session → upload-url → confirm → submit, by-ref), исходящего канала событий
  BillHub → EstiMat (/api/integration/events), маппинга объект/контрагент EstiMat→BillHub, приёма
  su10-заявок в раздел «Закупки». Триггеры: «интеграция EstiMat», «import-session», «api/external/v1»,
  «payment_request.workflow_changed», «Api-Key EstiMat», «external_ref estimat:pr», «раздел Закупки su10».
---

# Интеграция EstiMat ↔ BillHub — сторона BillHub

Двусторонняя интеграция. **EstiMat — инициатор** (подрядчик оформляет заявку на оплату типа
`own_supplier`; в EstiMat это `material_requests.request_type='own_supplier'`). **BillHub —
владелец жизненного цикла** (согласование Штаб→ОМТС→РП, документы, РП, оплата) и источник
обратных событий.

Каноничный wire-контракт — `EstiMat/integration/estimat-billhub/SKILL.md` (реализация стороны
EstiMat уже закоммичена). Этот скилл описывает **что делает BillHub**.

## Авторизация — Api-Key (НЕ Bearer)

Два независимых секрета по направлениям, сравнение constant-time, секреты только из env.

| Направление       | Куда                              | Заголовок                    | Токен (BillHub env)                          |
| ----------------- | --------------------------------- | ---------------------------- | -------------------------------------------- |
| EstiMat → BillHub | BillHub `/api/external/v1/*`      | `Authorization: Api-Key <t>` | `ESTIMAT_INBOUND_TOKEN` (BillHub валидирует) |
| BillHub → EstiMat | EstiMat `/api/integration/events` | `Authorization: Api-Key <t>` | `ESTIMAT_INTEGRATION_TOKEN` (BillHub шлёт)   |

`ESTIMAT_BASE_URL` — origin EstiMat; `ESTIMAT_SYNC_ENABLED` — рубильник отправки (по умолчанию
выкл). Пустой inbound-токен = входящий API выключен (401). Пустой base/integration-токен или
выключенный рубильник = исходящие события копятся в `integration_outbox` (waiting_config).
Ротация — current/previous с окном перекрытия.

## Направление 1. EstiMat → BillHub (реализует BillHub, префикс `/api/external/v1`)

Принципал `source_system='estimat'`. Отдельный preHandler Api-Key, изоляция от cookie-сессий,
исключение из CSRF, строгая zod-валидация, свой rate-limit.

- `GET /references/suppliers` → `{data:[{id,name,inn,securityStatus}]}` (только активные)
- `GET /references/shipping-options` → `{data:[{id,value}]}` (`payment_request_field_options`, `field_code='shipping'`)
- `GET /references/document-types` → `{data:[{id,name,category}]}`
- `POST /payment-requests/import` — сессия импорта. Тело: `{externalRef:'estimat:pr:<uuid>', payloadHash, request:{requestType:'contractor', projectCode, contractorInn, contractorName, supplierId, supplierInn, shippingConditionId, deliveryDays, deliveryDaysType, invoiceAmount, comment}}` → `{importId, replay}`. Идемпотентность по `(source_system, external_ref)`: тот же ref+hash → `replay:true`; ref+другой hash → `409 {error:{code:'idempotency_conflict'}}`.
- `POST /payment-requests/import/{importId}/files/upload-url` `{fileName, contentType}` → `{uploadUrl, fileKey}` (presigned PUT в S3 BillHub).
- `POST /payment-requests/import/{importId}/files/confirm` `{fileKey, documentTypeId, fileName, fileSize, mimeType}` → `{fileId}`.
- `POST /payment-requests/import/{importId}/submit` → `{requestId, number, url, aggregateVersion, replay}`. Только submit создаёт `payment_request` (тип `contractor`, старт Штаб). Маппинг `projectCode → construction_sites.estimat_project_code`, `contractorInn → counterparties.inn`. Требуется ≥1 подтверждённый счёт и сумма > 0.
- `GET /payment-requests/by-ref/{externalRef}` → полный snapshot проекции (reconciliation).

Схема БД (миграция `0019`): `external_import_sessions`, `external_import_files`,
`payment_requests.{source_system,external_ref,estimat_aggregate_version}`,
`construction_sites.estimat_project_code`.

## Направление 2. BillHub → EstiMat (эмитит BillHub)

При КАЖДОМ изменении заявки (согласование/доработка/документ/РП/оплата) BillHub кладёт событие в
**отдельный `integration_outbox`** (НЕ audit-outbox) и доставляет `POST {ESTIMAT}/api/integration/events`.
Каждое событие несёт полный snapshot и **монотонную `aggregateVersion`**; EstiMat применяет только
более новую версию, по `eventId` — идемпотентно.

Типы: `payment_request.workflow_changed | document_attached | rp_changed | rp_unlinked | payment_summary_changed`.

Snapshot (три независимые оси): `statusCode` (approv_shtab|approv_omts|approv_rp|approved|revision|
rejected|withdrawn), `actionRequired`, `revisionComment`, `requestNumber`, `requestUrl`, `rpNumber`,
`rpDate`, `paidStatus` (not_paid|partially_paid|paid), `totalPaid`, `lastPaymentDate`, `documents[]`.
`rp_unlinked` очищает `rpNumber` (полный snapshot очищает поля, не COALESCE).

Ответы EstiMat: `200 {data:{status:'applied'|'ignored_stale'|'duplicate'}}`; `409` «повторить позже»
(событие раньше ответа submit — доставить позже) или `409` тот же `eventId` с другим телом.

Реализация транспорта: `server/src/services/estimat/*` (клиент `sendEvent`, Api-Key, обработка 409).

## su10 (раздел «Закупки», путь 2) — greenfield-контракт

`material_requests.request_type='su10'` в EstiMat → раздел «Закупки» BillHub. Контракт импорта
зеркалит путь 1 (EstiMat пушит su10-заявки в BillHub), реализуется отдельно; BillHub строит
приёмник + stateful-мок. Отдельный набор эндпоинтов под `/api/external/v1/procurement-*`.

## Обработка ошибок / коды

`idempotency_conflict` (409, import с другим hash), `not_found` (409 «повторите позже» на событии),
временные (сеть/5xx/429) → ретрай очереди; постоянные 4xx → dead-letter.

## Acceptance-checklist (сторона BillHub)

- [ ] Api-Key middleware (constant-time, изоляция от cookie/CSRF), `ESTIMAT_INBOUND_TOKEN`.
- [ ] references (3 эндпоинта, только активные).
- [ ] import → upload-url → confirm → submit, идемпотентность по external_ref+hash, replay.
- [ ] Маппинг projectCode→объект, contractorInn→контрагент; отсутствие → blocked_mapping.
- [ ] submit создаёт contractor-заявку, стартует Штаб, возвращает aggregateVersion.
- [ ] by-ref snapshot.
- [ ] integration_outbox продюсеры во всех переходах; воркер доставки с backoff/sweep; монотонная версия; полный snapshot; 409-retry.
