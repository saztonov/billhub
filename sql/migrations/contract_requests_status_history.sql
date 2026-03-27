-- Добавление поля истории статусов в заявки на договоры
ALTER TABLE contract_requests
    ADD COLUMN IF NOT EXISTS status_history jsonb NOT NULL DEFAULT '[]';

COMMENT ON COLUMN contract_requests.status_history IS 'История изменений статусов заявки';
