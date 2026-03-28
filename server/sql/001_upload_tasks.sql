-- Таблица задач загрузки файлов (отслеживание прогресса пакетной загрузки)
CREATE TABLE IF NOT EXISTS upload_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL CHECK (type IN ('request_files', 'decision_files', 'contract_files', 'payment_files')),
  entity_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'error')),
  total_files INTEGER NOT NULL DEFAULT 0,
  uploaded_files INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Индекс для быстрого поиска активных задач
CREATE INDEX idx_upload_tasks_status ON upload_tasks(status) WHERE status IN ('pending', 'processing');

-- Индекс для поиска задач по сущности
CREATE INDEX idx_upload_tasks_entity ON upload_tasks(entity_id);
