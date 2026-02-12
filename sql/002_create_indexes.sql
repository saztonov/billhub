-- ============================================================================
-- BillHub: индексы для ускорения запросов
-- Запускать после 001_create_tables.sql
-- ============================================================================

-- Счета: поиск по контрагенту и статусу
create index if not exists idx_invoices_counterparty_id on invoices(counterparty_id);
create index if not exists idx_invoices_status on invoices(status);

-- Спецификации: поиск по счёту
create index if not exists idx_specifications_invoice_id on specifications(invoice_id);

-- Документы: поиск по контрагенту и объекту
create index if not exists idx_documents_counterparty_id on documents(counterparty_id);
create index if not exists idx_documents_site_id on documents(site_id);

-- Распред. письма: поиск по контрагенту, счёту, статусу
create index if not exists idx_distribution_letters_counterparty_id on distribution_letters(counterparty_id);
create index if not exists idx_distribution_letters_invoice_id on distribution_letters(invoice_id);
create index if not exists idx_distribution_letters_status on distribution_letters(status);

-- Маппинг обязательных документов: поиск по объекту
create index if not exists idx_site_required_docs_site_id on site_required_documents_mapping(site_id);

-- Этапы цепочки: поиск по цепочке
create index if not exists idx_approval_steps_chain_id on approval_steps(chain_id);

-- Согласования: поиск по РП
create index if not exists idx_approvals_distribution_letter_id on approvals(distribution_letter_id);
