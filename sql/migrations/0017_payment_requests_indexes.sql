-- Миграция 0017: индексы payment_requests под фильтры и сортировку списков.
--
-- Контекст:
--   Списочные запросы заявок сортируются по created_at DESC и фильтруются по
--   site_id (скоупинг user без all_sites), supplier_id и cost_type_id, но
--   индексов на этих полях не было (в отличие от contract_requests, где они есть).
--   На текущих объёмах (~1 тыс. строк) эффект минимален — это страховка роста.
--
-- Без top-level BEGIN/COMMIT — runner оборачивает миграцию в транзакцию (ADR-0002).
-- Идемпотентность: IF NOT EXISTS.

CREATE INDEX IF NOT EXISTS idx_payment_requests_created_at
    ON public.payment_requests (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_payment_requests_site
    ON public.payment_requests (site_id);

CREATE INDEX IF NOT EXISTS idx_payment_requests_supplier
    ON public.payment_requests (supplier_id);

CREATE INDEX IF NOT EXISTS idx_payment_requests_cost_type
    ON public.payment_requests (cost_type_id);
