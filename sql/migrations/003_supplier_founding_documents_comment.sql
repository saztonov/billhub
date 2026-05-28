-- Миграция: общий комментарий по учредительным документам поставщика
-- Добавляет поле suppliers.founding_documents_comment для хранения общего
-- комментария ко всем учредительным документам конкретного поставщика
-- (отдельно от комментариев к каждому типу документа в supplier_founding_documents.comment).

BEGIN;

ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS founding_documents_comment text NULL;

COMMIT;
