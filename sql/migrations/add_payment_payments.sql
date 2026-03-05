-- Миграция: Функционал оплат для заявок на оплату
-- 1. Seed-статусы оплаты (entity_type = 'paid')
-- 2. Новые поля в payment_requests (paid_status_id, total_paid)
-- 3. Таблица payment_payments
-- 4. Таблица payment_payment_files

-- 1. Статусы оплаты
INSERT INTO statuses (entity_type, code, name, color, is_active, display_order, visible_roles)
VALUES
  ('paid', 'not_paid', 'Не оплачено', 'default', true, 1, '{}'),
  ('paid', 'partially_paid', 'Оплачено частично', 'orange', true, 2, '{}'),
  ('paid', 'paid', 'Оплачено', 'green', true, 3, '{}');

-- 2. Новые поля в payment_requests
ALTER TABLE payment_requests
  ADD COLUMN paid_status_id uuid REFERENCES statuses(id),
  ADD COLUMN total_paid numeric(15,2) NOT NULL DEFAULT 0;

-- Заполнить paid_status_id значением "Не оплачено" для всех существующих заявок
UPDATE payment_requests
SET paid_status_id = (SELECT id FROM statuses WHERE entity_type = 'paid' AND code = 'not_paid' LIMIT 1)
WHERE paid_status_id IS NULL;

-- 3. Таблица оплат
CREATE TABLE payment_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_request_id uuid NOT NULL REFERENCES payment_requests(id),
  payment_number integer NOT NULL,
  payment_date date NOT NULL,
  amount numeric(15,2) NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id),
  updated_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz
);

CREATE INDEX idx_payment_payments_request ON payment_payments(payment_request_id);

-- 4. Таблица файлов оплат
CREATE TABLE payment_payment_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_payment_id uuid NOT NULL REFERENCES payment_payments(id) ON DELETE CASCADE,
  file_name varchar(255) NOT NULL,
  file_key varchar(500) NOT NULL,
  file_size bigint,
  mime_type varchar(100),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_payment_payment_files_payment ON payment_payment_files(payment_payment_id);
