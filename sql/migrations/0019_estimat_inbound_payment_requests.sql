-- Миграция 0019: приёмная сторона BillHub для интеграции EstiMat → BillHub (путь 1,
-- заявки на оплату по РП, тип own_supplier). EstiMat — инициатор (import-session → confirm
-- files → submit), BillHub — владелец жизненного цикла и источник обратных событий.
-- Контракт: EstiMat/integration/estimat-billhub/SKILL.md. Аутентификация — Api-Key.
--
--   * external_import_sessions / external_import_files — сессия импорта заявки: идемпотентна по
--     (source_system, external_ref); только submit создаёт payment_request и стартует Штаб.
--   * payment_requests.source_system / external_ref / estimat_aggregate_version — связь с внешней
--     заявкой EstiMat + монотонная версия исходящих событий (порядок применения на стороне EstiMat).
--   * construction_sites.estimat_project_code — маппинг projectCode (EstiMat) → объект BillHub
--     (по образцу payhub_project_code из 0007). Контрагент маппится по counterparties.inn.
--   * integration_outbox — надёжная исходящая очередь событий в EstiMat (POST /api/integration/events),
--     ОТДЕЛЬНАЯ от audit-outbox (0002). Зеркалит дизайн integration_outbox EstiMat (SKIP LOCKED + backoff).
--
-- Без top-level BEGIN/COMMIT — runner оборачивает миграцию в транзакцию (ADR-0002).
-- Аддитивная и идемпотентная (IF NOT EXISTS / ON CONFLICT).

-- ============================================================
-- 1. Связь заявки на оплату с внешней заявкой EstiMat + версия событий
-- ============================================================
ALTER TABLE public.payment_requests
  ADD COLUMN IF NOT EXISTS source_system            text,
  ADD COLUMN IF NOT EXISTS external_ref             text,
  ADD COLUMN IF NOT EXISTS estimat_aggregate_version integer NOT NULL DEFAULT 0;

-- Идемпотентность создания заявки пути 1: один external_ref = одна заявка (для непустых значений).
CREATE UNIQUE INDEX IF NOT EXISTS ux_payment_requests_external_ref
  ON public.payment_requests (external_ref) WHERE external_ref IS NOT NULL;

-- ============================================================
-- 2. Маппинг объекта EstiMat → construction_sites
-- ============================================================
ALTER TABLE public.construction_sites
  ADD COLUMN IF NOT EXISTS estimat_project_code text;

CREATE UNIQUE INDEX IF NOT EXISTS ux_construction_sites_estimat_project_code
  ON public.construction_sites (estimat_project_code) WHERE estimat_project_code IS NOT NULL;

-- ============================================================
-- 3. Сессия импорта заявки (import-session → confirm files → submit)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.external_import_sessions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_system       text NOT NULL DEFAULT 'estimat',
  external_ref        text NOT NULL,                 -- estimat:pr:<uuid>
  payload_hash        text NOT NULL,                 -- sha256 тела запроса (детект idempotency_conflict)
  request_payload     jsonb NOT NULL,                -- снимок полей заявки (projectCode/contractorInn/supplier/...)
  status              text NOT NULL DEFAULT 'open',  -- open | submitted
  payment_request_id  uuid REFERENCES public.payment_requests(id) ON DELETE SET NULL, -- ставится на submit
  created_at          timestamptz NOT NULL DEFAULT now(),
  submitted_at        timestamptz,
  -- Идемпотентность: тот же external_ref + тот же hash → replay; другой hash → 409 idempotency_conflict.
  CONSTRAINT external_import_sessions_ref_unique UNIQUE (source_system, external_ref)
);
CREATE INDEX IF NOT EXISTS idx_external_import_sessions_pr
  ON public.external_import_sessions (payment_request_id);

-- Файлы-счета сессии импорта (presigned upload в S3 BillHub → confirm → перенос в payment_request_files на submit).
CREATE TABLE IF NOT EXISTS public.external_import_files (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_session_id   uuid NOT NULL REFERENCES public.external_import_sessions(id) ON DELETE CASCADE,
  file_key            text NOT NULL,                 -- ключ в S3 BillHub (staged)
  document_type_id    uuid,
  file_name           text NOT NULL,
  file_size           bigint,
  mime_type           text,
  checksum            text,
  payment_request_file_id uuid,                      -- id в payment_request_files после submit
  created_at          timestamptz NOT NULL DEFAULT now(),
  -- Идемпотентность confirm: один slot (файл) на сессию.
  CONSTRAINT external_import_files_session_key_unique UNIQUE (import_session_id, file_key)
);
CREATE INDEX IF NOT EXISTS idx_external_import_files_session
  ON public.external_import_files (import_session_id);

-- ============================================================
-- 4. Исходящая очередь событий BillHub → EstiMat (integration outbox)
-- ============================================================
-- Отдельно от audit-outbox (0002): доменные транзакции публикуют событие, воркер доставляет
-- POST {ESTIMAT}/api/integration/events с полным snapshot и монотонной aggregate_version.
CREATE TABLE IF NOT EXISTS public.integration_outbox (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aggregate_type    text NOT NULL,                  -- 'payment_request'
  aggregate_id      uuid NOT NULL,
  event_type        text NOT NULL,                  -- payment_request.workflow_changed | document_attached | rp_changed | rp_unlinked | payment_summary_changed
  external_ref      text NOT NULL,                  -- estimat:pr:<uuid>
  event_id          uuid NOT NULL DEFAULT gen_random_uuid(), -- уникальный id доставки (идемпотентность на приёмнике)
  aggregate_version integer NOT NULL,               -- монотонная версия проекции на момент события
  payload           jsonb,                          -- снимок (может собираться воркером на момент доставки)
  status            text NOT NULL DEFAULT 'queued', -- queued | retry_wait | waiting_config | delivered | dead_letter
  attempts          integer NOT NULL DEFAULT 0,
  last_attempt_at   timestamptz,
  next_attempt_at   timestamptz NOT NULL DEFAULT now(),
  lease_token       uuid,
  locked_until      timestamptz,
  error_code        text,
  last_error        text,
  delivered_at      timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT integration_outbox_status_check
    CHECK (status IN ('queued', 'retry_wait', 'waiting_config', 'delivered', 'dead_letter'))
);

-- Индекс для claim воркером (SKIP LOCKED): незавершённые по времени следующей попытки.
CREATE INDEX IF NOT EXISTS idx_integration_outbox_due
  ON public.integration_outbox (next_attempt_at)
  WHERE status IN ('queued', 'retry_wait', 'waiting_config');
CREATE INDEX IF NOT EXISTS idx_integration_outbox_aggregate
  ON public.integration_outbox (aggregate_id);
