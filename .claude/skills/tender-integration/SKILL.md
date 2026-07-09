---
name: tender-integration
description: >-
  Интеграция BillHub с тендерным порталом (раздел «Закупки», путь 2). BillHub — инициатор:
  создаёт тендер по лоту, опрашивает результаты (участники, предложения, победитель). Портал
  строится в ОТДЕЛЬНОМ проекте по этому контракту; здесь — сторона BillHub (клиент) + контракт
  как задание порталу. Использовать при реализации/отладке клиента тендера, действия «вывести на
  тендер», опроса результатов, нормализации предложений. Триггеры: «тендерный портал», «создать
  тендер», «getTenderResults», «Bearer тендер», «sourcing_round tender», «billhub:tender».
---

# Интеграция с тендерным порталом — сторона BillHub

BillHub — **инициатор**. Тендер подключается как тип раунда закупки (`sourcing_round.kind='tender'`);
отдельного дублирующего набора полей на заказе нет. Результаты нормализуются в те же
`supplier_offers`/`supplier_offer_items`, что и RFQ по email. Портал строится в отдельном проекте
по этому контракту.

## Авторизация — Bearer

`Authorization: Bearer <TENDER_API_TOKEN>`; `TENDER_BASE_URL` — origin портала. Пусто = интеграция
не настроена (клиент `fastify.tender = null`). Префикс API — `/api/external/v1`.
Реализация клиента: `server/src/services/tender/*`.

## Эндпоинты (реализует ТЕНДЕРНЫЙ ПОРТАЛ; вызывает BillHub)

- `POST /tenders` — создать тендер. Тело: `{title, external_ref:'billhub:tender:<sourcingRoundId>', deadline_at?, items:[{material, quantity, unit?, spec?}], conditions:{delivery?, payment?, deadline?}}` → `{id, status, url?}`. **Идемпотентно по `external_ref`** (повтор → тот же тендер).
- `GET /tenders/{id}` → `{id, external_ref?, status, url?}`. Статусы: `draft|published|awaiting_results|finished|cancelled`.
- `GET /tenders/{id}/results` → `{tender_id, status, participants:[{id,name,inn?}], bids:[{participant_id, amount, currency?, delivery_terms?, payment_terms?, submitted_at?}], winner?:{participant_id, bid_index?}, finished_at?}`.
- `POST /tenders/{id}/cancel` → 204.
- `GET /health` — дешёвая проверка доступности (для админ-статуса, `ping`).

Envelope ошибок: `{error:{code,message}}`. Коды: `api_key_required`, `api_key_invalid`,
`api_key_expired`, `insufficient_scope`, `external_ref_conflict`, `not_found`, `validation_error`.

## Модель асинхронности результатов

BillHub опрашивает `GET /tenders/{id}/results` (poll + sweep каждые ~10 мин) до `status='finished'`.
Портал ОБЯЗАН: идемпотентный `POST /tenders` по `external_ref`; стабильный `results`-эндпоинт.
Опциональный webhook «тендер завершён» ускоряет, но poll остаётся механизмом reconciliation.
Победитель портала — внешний результат; каноническое присуждение (`procurement_awards`) подтверждает
менеджер BillHub.

## Ретраи

Транспорт: 429 — для всех методов (Retry-After); 5xx/сеть — только для GET; мутации не повторяет
(идемпотентность `createTender` по `external_ref` + доводит очередь `tender-sync`).

## Acceptance-checklist (тендерный портал, по этому контракту)

- [ ] Bearer-аутентификация, коды ошибок `{error:{code,message}}`.
- [ ] `POST /tenders` идемпотентно по `external_ref` (повтор → тот же тендер, без дублей).
- [ ] `GET /tenders/{id}/results`: участники, предложения (суммы/условия/время), победитель, `finished_at`.
- [ ] Статусная модель `draft→published→awaiting_results→finished|cancelled`.
- [ ] Опциональный webhook завершения (event_id, идемпотентность).
- [ ] Mock-фикстуры «черновик → опубликован → предложения → завершён» для отладки poll без портала.
