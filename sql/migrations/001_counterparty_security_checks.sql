-- Миграция: проверка контрагентов отделом СБ
-- Создаёт таблицу истории событий проверок, расширяет users.role и notifications.
-- Добавляет RPC-функцию для серверной пагинации списка поставщиков с агрегатами по СБ.

BEGIN;

-- 1. Расширяем check-constraint роли пользователя ролью 'security'
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE public.users
  ADD CONSTRAINT users_role_check
  CHECK (role = ANY (ARRAY['admin'::text, 'user'::text, 'counterparty_user'::text, 'security'::text]));

-- 2. Новая таблица истории событий проверки контрагентов отделом СБ
CREATE TABLE IF NOT EXISTS public.counterparty_security_checks (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  counterparty_id  uuid NOT NULL REFERENCES public.counterparties(id) ON DELETE CASCADE,
  author_id        uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  event_type       text NOT NULL,
  comment          text NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT counterparty_security_checks_event_type_check
    CHECK (event_type = ANY (ARRAY['requested'::text, 'approved'::text, 'rejected'::text]))
);

CREATE INDEX IF NOT EXISTS idx_cp_sb_checks_counterparty_created
  ON public.counterparty_security_checks (counterparty_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_cp_sb_checks_author
  ON public.counterparty_security_checks (author_id);

-- 3. Колонка counterparty_id в notifications для deep-link на модалку поставщика
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS counterparty_id uuid NULL
    REFERENCES public.counterparties(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_notifications_counterparty
  ON public.notifications (counterparty_id);

-- 4. RPC: список поставщиков с агрегатами по проверке СБ, поиском, пагинацией и фильтром
DROP FUNCTION IF EXISTS public.list_counterparties_with_sb(text, text, integer, integer, date, uuid);

CREATE OR REPLACE FUNCTION public.list_counterparties_with_sb(
  p_search             text,
  p_sb_filter          text,
  p_page               integer,
  p_page_size          integer,
  p_cutoff_date        date,
  p_only_counterparty_id uuid DEFAULT NULL
)
RETURNS TABLE (
  id                    uuid,
  name                  text,
  inn                   text,
  address               text,
  alternative_names     jsonb,
  registration_token    uuid,
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
      c.id,
      c.name,
      c.inn,
      c.address,
      c.alternative_names,
      c.registration_token,
      c.created_at,
      ld.event_type AS last_security_status,
      ld.created_at AS last_security_at,
      (lr.created_at IS NOT NULL
        AND (ld.created_at IS NULL OR lr.created_at > ld.created_at)) AS has_pending_request
    FROM public.counterparties c
    LEFT JOIN LATERAL (
      SELECT event_type, created_at
      FROM public.counterparty_security_checks
      WHERE counterparty_id = c.id
        AND event_type IN ('approved','rejected')
      ORDER BY created_at DESC
      LIMIT 1
    ) ld ON true
    LEFT JOIN LATERAL (
      SELECT created_at
      FROM public.counterparty_security_checks
      WHERE counterparty_id = c.id
        AND event_type = 'requested'
      ORDER BY created_at DESC
      LIMIT 1
    ) lr ON true
    WHERE
      (p_only_counterparty_id IS NULL OR c.id = p_only_counterparty_id)
      AND (
        p_search IS NULL OR p_search = ''
        OR c.name ILIKE '%' || p_search || '%'
        OR c.inn ILIKE '%' || p_search || '%'
        OR EXISTS (
          SELECT 1
          FROM jsonb_array_elements_text(c.alternative_names) alt
          WHERE alt ILIKE '%' || p_search || '%'
        )
      )
      AND (
        p_sb_filter <> 'pending'
        OR (
          (c.created_at >= p_cutoff_date AND ld.created_at IS NULL)
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
    b.address,
    b.alternative_names,
    b.registration_token,
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
