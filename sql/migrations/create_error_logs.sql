-- Создание таблицы для логирования ошибок клиентского приложения
CREATE TABLE IF NOT EXISTS error_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  error_type VARCHAR(50) NOT NULL,
  error_message TEXT NOT NULL,
  error_stack TEXT,
  url TEXT,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  user_agent TEXT,
  component VARCHAR(255),
  metadata JSONB
);

-- Индексы для оптимизации запросов в админке
CREATE INDEX idx_error_logs_created_at ON error_logs (created_at DESC);
CREATE INDEX idx_error_logs_error_type ON error_logs (error_type);
CREATE INDEX idx_error_logs_user_id ON error_logs (user_id);
CREATE INDEX idx_error_logs_type_created ON error_logs (error_type, created_at DESC);
