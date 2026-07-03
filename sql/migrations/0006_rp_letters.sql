-- Миграция 0006: реестр распределительных писем (РП) на основе согласованных заявок.
--
-- Контекст: страница «РП» (/distribution-letters) достраивается до рабочего экрана ОМТС.
-- Пользователь ОМТС выделяет согласованные заявки на оплату с ОДНОЙ связкой
-- Поставщик+Подрядчик+Объект и объединяет их в одно распределительное письмо (РП).
-- Существующая legacy-таблица distribution_letters (одиночный invoice_id, без поставщика и без
-- связи с payment_requests) под задачу не подходит и НЕ трогается.
--
-- Модель:
--   rp_letters           — запись реестра РП (номер, дата, связка, сумма, описание, статус).
--   rp_letter_requests   — M2M «РП ↔ заявка»; UNIQUE(payment_request_id) => заявка входит максимум
--                          в одну РП (это же реализует пометку «в РП»).
--   rp_letter_documents  — снимок выбранных в модалке документов (договор + учредительные).
--
-- Номер РП формата «РП-000001» генерируется на сервере из sequence rp_letters_number_seq.
-- Статус оплаты в БД НЕ хранится — вычисляется на чтении из totalPaid/invoiceAmount заявок.
--
-- Без top-level BEGIN/COMMIT — runner оборачивает миграцию в транзакцию (ADR-0002).
-- Идемпотентность — через IF NOT EXISTS.

CREATE SEQUENCE IF NOT EXISTS public.rp_letters_number_seq;

CREATE TABLE IF NOT EXISTS public.rp_letters (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number          text NOT NULL,
  letter_date     date,
  supplier_id     uuid NOT NULL REFERENCES public.suppliers(id),
  counterparty_id uuid NOT NULL REFERENCES public.counterparties(id),
  site_id         uuid NOT NULL REFERENCES public.construction_sites(id),
  total_amount    numeric(15,2) NOT NULL DEFAULT 0,
  description     text NOT NULL DEFAULT '',
  status          text NOT NULL DEFAULT 'draft',
  created_by      uuid NOT NULL REFERENCES public.users(id),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rp_letters_supplier_id ON public.rp_letters (supplier_id);
CREATE INDEX IF NOT EXISTS idx_rp_letters_counterparty_id ON public.rp_letters (counterparty_id);
CREATE INDEX IF NOT EXISTS idx_rp_letters_site_id ON public.rp_letters (site_id);
CREATE INDEX IF NOT EXISTS idx_rp_letters_status ON public.rp_letters (status);
CREATE INDEX IF NOT EXISTS idx_rp_letters_created_at ON public.rp_letters (created_at);

CREATE TABLE IF NOT EXISTS public.rp_letter_requests (
  rp_letter_id       uuid NOT NULL REFERENCES public.rp_letters(id) ON DELETE CASCADE,
  payment_request_id uuid NOT NULL REFERENCES public.payment_requests(id),
  PRIMARY KEY (rp_letter_id, payment_request_id),
  CONSTRAINT rp_letter_requests_payment_request_unique UNIQUE (payment_request_id)
);

CREATE INDEX IF NOT EXISTS idx_rp_letter_requests_payment_request_id
  ON public.rp_letter_requests (payment_request_id);

CREATE TABLE IF NOT EXISTS public.rp_letter_documents (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rp_letter_id    uuid NOT NULL REFERENCES public.rp_letters(id) ON DELETE CASCADE,
  source          text NOT NULL,
  file_key        text NOT NULL,
  file_name       text NOT NULL,
  mime_type       text,
  contract_number text,
  contract_date   date,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rp_letter_documents_source_check CHECK (source IN ('contract', 'founding'))
);

CREATE INDEX IF NOT EXISTS idx_rp_letter_documents_rp_letter_id
  ON public.rp_letter_documents (rp_letter_id);
