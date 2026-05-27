-- Миграция: проверка поставщиков отделом СБ
-- Добавляет таблицу истории событий проверки suppliers, колонку supplier_id в notifications
-- и RPC-функцию для серверной пагинации списка поставщиков с агрегатами по СБ.
-- Сущности от миграции 001 (counterparty_security_checks, notifications.counterparty_id,
-- list_counterparties_with_sb) остаются в БД нетронутыми.

BEGIN;

-- 1. Таблица истории событий проверки поставщиков отделом СБ
CREATE TABLE IF NOT EXISTS public.supplier_security_checks (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id  uuid NOT NULL REFERENCES public.suppliers(id) ON DELETE CASCADE,
  author_id    uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  event_type   text NOT NULL,
  comment      text NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT supplier_security_checks_event_type_check
    CHECK (event_type = ANY (ARRAY['requested'::text, 'approved'::text, 'rejected'::text]))
);

CREATE INDEX IF NOT EXISTS idx_sup_sb_checks_supplier_created
  ON public.supplier_security_checks (supplier_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sup_sb_checks_author
  ON public.supplier_security_checks (author_id);

-- 2. Колонка supplier_id в notifications для deep-link на модалку поставщика
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS supplier_id uuid NULL
    REFERENCES public.suppliers(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_notifications_supplier
  ON public.notifications (supplier_id);

-- 3. RPC: список поставщиков с агрегатами по проверке СБ, поиском, пагинацией и фильтром
DROP FUNCTION IF EXISTS public.list_suppliers_with_sb(text, text, integer, integer, date, uuid);

CREATE OR REPLACE FUNCTION public.list_suppliers_with_sb(
  p_search          text,
  p_sb_filter       text,
  p_page            integer,
  p_page_size       integer,
  p_cutoff_date     date,
  p_only_supplier_id uuid DEFAULT NULL
)
RETURNS TABLE (
  id                    uuid,
  name                  text,
  inn                   text,
  alternative_names     jsonb,
  created_at            timestamptz,
  last_security_status  text,
  last_security_at      timestamptz,
  has_pending_request   boolean,
  total_count           bigint
)
LANGUAGE sql
STABLE
AS $$
  WITH base AS (
    SELECT
      s.id,
      s.name,
      s.inn,
      s.alternative_names,
      s.created_at,
      ld.event_type AS last_security_status,
      ld.created_at AS last_security_at,
      (lr.created_at IS NOT NULL
        AND (ld.created_at IS NULL OR lr.created_at > ld.created_at)) AS has_pending_request
    FROM public.suppliers s
    LEFT JOIN LATERAL (
      SELECT event_type, created_at
      FROM public.supplier_security_checks
      WHERE supplier_id = s.id
        AND event_type IN ('approved','rejected')
      ORDER BY created_at DESC
      LIMIT 1
    ) ld ON true
    LEFT JOIN LATERAL (
      SELECT created_at
      FROM public.supplier_security_checks
      WHERE supplier_id = s.id
        AND event_type = 'requested'
      ORDER BY created_at DESC
      LIMIT 1
    ) lr ON true
    WHERE
      (p_only_supplier_id IS NULL OR s.id = p_only_supplier_id)
      AND (
        p_search IS NULL OR p_search = ''
        OR s.name ILIKE '%' || p_search || '%'
        OR s.inn ILIKE '%' || p_search || '%'
        OR EXISTS (
          SELECT 1
          FROM jsonb_array_elements_text(COALESCE(s.alternative_names, '[]'::jsonb)) alt
          WHERE alt ILIKE '%' || p_search || '%'
        )
      )
      AND (
        p_sb_filter <> 'pending'
        OR (
          (s.created_at >= p_cutoff_date AND ld.created_at IS NULL)
          OR (lr.created_at IS NOT NULL
              AND (ld.created_at IS NULL OR lr.created_at > ld.created_at))
        )
      )
  ),
  counted AS (
    SELECT COUNT(*) AS total_count FROM base
  )
  SELECT
    b.id,
    b.name,
    b.inn,
    b.alternative_names,
    b.created_at,
    b.last_security_status,
    b.last_security_at,
    b.has_pending_request,
    (SELECT total_count FROM counted) AS total_count
  FROM base b
  ORDER BY b.created_at DESC
  LIMIT p_page_size OFFSET ((p_page - 1) * p_page_size);
$$;

COMMIT;
