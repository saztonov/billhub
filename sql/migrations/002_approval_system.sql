-- Миграция: система согласования заявок на оплату

-- 1. Удаление старых таблиц согласований (в порядке зависимостей)
DROP TABLE IF EXISTS approvals CASCADE;
DROP TABLE IF EXISTS approval_steps CASCADE;
DROP TABLE IF EXISTS approval_chain_edges CASCADE;
DROP TABLE IF EXISTS approval_chain_nodes CASCADE;
DROP TABLE IF EXISTS approval_chains CASCADE;

-- 2. Конфигурация этапов согласования (одна глобальная цепочка)
-- Каждая строка = одно подразделение на одном этапе
-- Этап 1 с подразделениями A, B — 2 строки с stage_order=1
CREATE TABLE approval_stages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stage_order integer NOT NULL,
  department_id uuid NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(stage_order, department_id)
);

CREATE INDEX idx_approval_stages_order ON approval_stages(stage_order);
CREATE INDEX idx_approval_stages_department ON approval_stages(department_id);

-- 3. Решения по согласованию заявок
CREATE TABLE approval_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_request_id uuid NOT NULL REFERENCES payment_requests(id) ON DELETE CASCADE,
  stage_order integer NOT NULL,
  department_id uuid NOT NULL REFERENCES departments(id),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  user_id uuid REFERENCES users(id),
  comment text NOT NULL DEFAULT '',
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(payment_request_id, stage_order, department_id)
);

CREATE INDEX idx_approval_decisions_request ON approval_decisions(payment_request_id);
CREATE INDEX idx_approval_decisions_department ON approval_decisions(department_id);
CREATE INDEX idx_approval_decisions_status ON approval_decisions(status);

-- 4. Новые столбцы в payment_requests
ALTER TABLE payment_requests
  ADD COLUMN current_stage integer DEFAULT NULL,
  ADD COLUMN approved_at timestamptz DEFAULT NULL,
  ADD COLUMN rejected_at timestamptz DEFAULT NULL;
