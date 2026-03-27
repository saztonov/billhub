-- ============================================================
-- Миграция: Заявки на договоры (contract_requests)
-- Дата: 2026-03-26
-- ============================================================

-- ----------------------------------------------------------
-- 1. Таблица заявок на договоры
-- ----------------------------------------------------------

CREATE TABLE IF NOT EXISTS contract_requests (
    id                   uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
    request_number       varchar(20)    NOT NULL,
    site_id              uuid           NOT NULL REFERENCES construction_sites(id),
    counterparty_id      uuid           NOT NULL REFERENCES counterparties(id),
    supplier_id          uuid           NOT NULL REFERENCES suppliers(id),
    parties_count        smallint       NOT NULL CHECK (parties_count IN (2, 3, 4)),
    subject_type         varchar(50)    NOT NULL CHECK (subject_type IN ('general', 'metal', 'non_metallic', 'concrete')),
    subject_detail       text,
    status_id            uuid           NOT NULL REFERENCES statuses(id),
    revision_targets     text[]         NOT NULL DEFAULT '{}',
    created_by           uuid           NOT NULL REFERENCES users(id),
    created_at           timestamptz    NOT NULL DEFAULT now(),
    is_deleted           boolean        NOT NULL DEFAULT false,
    deleted_at           timestamptz,
    original_received_at timestamptz
);

COMMENT ON TABLE contract_requests IS 'Заявки на заключение договоров';
COMMENT ON COLUMN contract_requests.request_number IS 'Номер заявки в формате Д-YYYY-NNNNN';
COMMENT ON COLUMN contract_requests.site_id IS 'Объект строительства';
COMMENT ON COLUMN contract_requests.counterparty_id IS 'Контрагент';
COMMENT ON COLUMN contract_requests.supplier_id IS 'Поставщик';
COMMENT ON COLUMN contract_requests.parties_count IS 'Количество сторон договора (2, 3 или 4)';
COMMENT ON COLUMN contract_requests.subject_type IS 'Тип предмета договора (general, metal, non_metallic, concrete)';
COMMENT ON COLUMN contract_requests.subject_detail IS 'Детализация предмета договора';
COMMENT ON COLUMN contract_requests.status_id IS 'Текущий статус заявки';
COMMENT ON COLUMN contract_requests.revision_targets IS 'Адресаты доработки (массив)';
COMMENT ON COLUMN contract_requests.created_by IS 'Автор заявки';
COMMENT ON COLUMN contract_requests.is_deleted IS 'Признак мягкого удаления';
COMMENT ON COLUMN contract_requests.deleted_at IS 'Дата мягкого удаления';
COMMENT ON COLUMN contract_requests.original_received_at IS 'Дата получения оригинала договора';

-- Индексы для таблицы contract_requests
CREATE INDEX idx_contract_requests_site_id
    ON contract_requests (site_id);

CREATE INDEX idx_contract_requests_counterparty_id
    ON contract_requests (counterparty_id);

CREATE INDEX idx_contract_requests_supplier_id
    ON contract_requests (supplier_id);

CREATE INDEX idx_contract_requests_status_id
    ON contract_requests (status_id);

CREATE INDEX idx_contract_requests_created_at
    ON contract_requests (created_at DESC);

CREATE INDEX idx_contract_requests_not_deleted
    ON contract_requests (id)
    WHERE is_deleted = false;

-- ----------------------------------------------------------
-- 2. Таблица файлов заявок на договоры
-- ----------------------------------------------------------

CREATE TABLE IF NOT EXISTS contract_request_files (
    id                  uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_request_id uuid           NOT NULL REFERENCES contract_requests(id) ON DELETE CASCADE,
    file_name           varchar(255)   NOT NULL,
    file_key            varchar(500)   NOT NULL,
    file_size           bigint,
    mime_type           varchar(100),
    created_by          uuid           NOT NULL REFERENCES users(id),
    created_at          timestamptz    NOT NULL DEFAULT now(),
    is_additional       boolean        NOT NULL DEFAULT false,
    is_rejected         boolean        NOT NULL DEFAULT false,
    rejected_by         uuid           REFERENCES users(id),
    rejected_at         timestamptz
);

COMMENT ON TABLE contract_request_files IS 'Файлы, прикрепленные к заявкам на договоры';
COMMENT ON COLUMN contract_request_files.contract_request_id IS 'Ссылка на заявку';
COMMENT ON COLUMN contract_request_files.file_name IS 'Имя файла';
COMMENT ON COLUMN contract_request_files.file_key IS 'Ключ файла в S3-хранилище';
COMMENT ON COLUMN contract_request_files.is_additional IS 'Признак дополнительного файла';
COMMENT ON COLUMN contract_request_files.is_rejected IS 'Признак отклоненного файла';
COMMENT ON COLUMN contract_request_files.rejected_by IS 'Кто отклонил файл';
COMMENT ON COLUMN contract_request_files.rejected_at IS 'Дата отклонения файла';

-- Индекс для таблицы contract_request_files
CREATE INDEX idx_contract_request_files_request_id
    ON contract_request_files (contract_request_id);

-- ----------------------------------------------------------
-- 3. Таблица комментариев к заявкам на договоры
-- ----------------------------------------------------------

CREATE TABLE IF NOT EXISTS contract_request_comments (
    id                  uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_request_id uuid           NOT NULL REFERENCES contract_requests(id) ON DELETE CASCADE,
    author_id           uuid           NOT NULL REFERENCES users(id),
    text                text           NOT NULL,
    recipient           text,
    created_at          timestamptz    NOT NULL DEFAULT now(),
    updated_at          timestamptz
);

COMMENT ON TABLE contract_request_comments IS 'Комментарии к заявкам на договоры';
COMMENT ON COLUMN contract_request_comments.contract_request_id IS 'Ссылка на заявку';
COMMENT ON COLUMN contract_request_comments.author_id IS 'Автор комментария';
COMMENT ON COLUMN contract_request_comments.text IS 'Текст комментария';
COMMENT ON COLUMN contract_request_comments.recipient IS 'Адресат комментария';

-- Составной индекс для выборки комментариев по заявке с сортировкой
CREATE INDEX idx_contract_request_comments_request_created
    ON contract_request_comments (contract_request_id, created_at);

-- ----------------------------------------------------------
-- 4. Таблица статусов прочтения комментариев
-- ----------------------------------------------------------

CREATE TABLE IF NOT EXISTS contract_comment_read_status (
    id                  uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             uuid           NOT NULL REFERENCES users(id),
    contract_request_id uuid           NOT NULL REFERENCES contract_requests(id) ON DELETE CASCADE,
    last_read_at        timestamptz    NOT NULL DEFAULT now()
);

COMMENT ON TABLE contract_comment_read_status IS 'Статус прочтения комментариев к заявкам на договоры';
COMMENT ON COLUMN contract_comment_read_status.user_id IS 'Пользователь';
COMMENT ON COLUMN contract_comment_read_status.contract_request_id IS 'Ссылка на заявку';
COMMENT ON COLUMN contract_comment_read_status.last_read_at IS 'Дата последнего прочтения';

-- Уникальный индекс: один пользователь — одна запись на заявку
CREATE UNIQUE INDEX idx_contract_comment_read_status_user_request
    ON contract_comment_read_status (user_id, contract_request_id);

-- ----------------------------------------------------------
-- 5. Функция генерации номера заявки на договор
-- ----------------------------------------------------------

CREATE SEQUENCE IF NOT EXISTS contract_request_number_seq;

CREATE OR REPLACE FUNCTION generate_contract_request_number()
RETURNS varchar
LANGUAGE plpgsql
VOLATILE
AS $$
DECLARE
    next_val bigint;
    current_year text;
BEGIN
    next_val := nextval('contract_request_number_seq');
    current_year := to_char(now(), 'YY');
    RETURN 'Д-' || current_year || '-' || next_val::text;
END;
$$;

COMMENT ON FUNCTION generate_contract_request_number() IS 'Генерация номера заявки на договор в формате Д-YY-N';

-- ----------------------------------------------------------
-- 6. Статусы для заявок на договоры
-- ----------------------------------------------------------

INSERT INTO statuses (entity_type, code, name, color, is_active, display_order, visible_roles)
VALUES
    ('contract_request', 'approv_omts',      'Согласование ОМТС',              '#1677ff', true, 1, ARRAY['admin', 'user', 'counterparty_user']),
    ('contract_request', 'on_revision',      'На доработке',                   '#fa8c16', true, 2, ARRAY['admin', 'user', 'counterparty_user']),
    ('contract_request', 'approved_waiting', 'Согласовано, ожидание оригинала', '#52c41a', true, 3, ARRAY['admin', 'user', 'counterparty_user']),
    ('contract_request', 'concluded',        'Заключен',                       '#389e0d', true, 4, ARRAY['admin', 'user', 'counterparty_user']);

-- ----------------------------------------------------------
-- 7. Добавление колонки contract_request_id в notifications
-- ----------------------------------------------------------

ALTER TABLE notifications
    ADD COLUMN IF NOT EXISTS contract_request_id uuid REFERENCES contract_requests(id);

COMMENT ON COLUMN notifications.contract_request_id IS 'Ссылка на заявку на договор (для уведомлений по договорам)';
