--
-- PostgreSQL database dump
--

\restrict zKXyHovnLjDM6aIzMh29ZFKG5dE1b9NgBxGa2RSkFK4wwC84My0oorECXK8T063

-- Dumped from database version 17.6
-- Dumped by pg_dump version 18.1

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: department_enum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.department_enum AS ENUM (
    'omts',
    'shtab',
    'smetny'
);


--
-- Name: change_user_password(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.change_user_password(target_user_id uuid, new_password text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_caller_role text;
BEGIN
  -- Проверяем роль вызывающего пользователя
  SELECT role INTO v_caller_role
    FROM public.users
   WHERE id = auth.uid();

  IF v_caller_role IS NULL OR v_caller_role != 'admin' THEN
    RAISE EXCEPTION 'Доступ запрещён: только администратор может менять пароли';
  END IF;

  -- Проверяем минимальную длину пароля
  IF length(new_password) < 8 THEN
    RAISE EXCEPTION 'Пароль должен содержать минимум 8 символов';
  END IF;

  -- Проверяем что целевой пользователь существует
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = target_user_id) THEN
    RAISE EXCEPTION 'Пользователь не найден';
  END IF;

  -- Обновляем пароль
  UPDATE auth.users
     SET encrypted_password = crypt(new_password, gen_salt('bf'))
   WHERE id = target_user_id;
END;
$$;


--
-- Name: generate_contract_request_number(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.generate_contract_request_number() RETURNS character varying
    LANGUAGE plpgsql
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


--
-- Name: FUNCTION generate_contract_request_number(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.generate_contract_request_number() IS 'Генерация номера заявки на договор в формате Д-YYYY-NNNNN';


--
-- Name: generate_request_number(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.generate_request_number() RETURNS character varying
    LANGUAGE plpgsql
    AS $$
DECLARE
  current_year INT;
  next_number INT;
BEGIN
  current_year := EXTRACT(YEAR FROM CURRENT_DATE);

  INSERT INTO request_number_sequence (year, last_number)
  VALUES (current_year, 1)
  ON CONFLICT (year) DO UPDATE
    SET last_number = request_number_sequence.last_number + 1
  RETURNING last_number INTO next_number;

  -- Возвращаем только порядковый номер без нулей и даты
  RETURN next_number::TEXT;
END;
$$;


--
-- Name: list_counterparties_with_sb(text, text, integer, integer, date, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.list_counterparties_with_sb(p_search text, p_sb_filter text, p_page integer, p_page_size integer, p_cutoff_date date, p_only_counterparty_id uuid DEFAULT NULL::uuid) RETURNS TABLE(id uuid, name text, inn text, address text, alternative_names jsonb, registration_token uuid, created_at timestamp with time zone, last_security_status text, last_security_at timestamp with time zone, has_pending_request boolean, total_count bigint)
    LANGUAGE sql STABLE
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


--
-- Name: list_suppliers_with_sb(text, text, integer, integer, date, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.list_suppliers_with_sb(p_search text, p_sb_filter text, p_page integer, p_page_size integer, p_cutoff_date date, p_only_supplier_id uuid DEFAULT NULL::uuid) RETURNS TABLE(id uuid, name text, inn text, alternative_names jsonb, created_at timestamp with time zone, last_security_status text, last_security_at timestamp with time zone, has_pending_request boolean, total_count bigint)
    LANGUAGE sql STABLE
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


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: approval_decision_files; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.approval_decision_files (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    approval_decision_id uuid NOT NULL,
    file_name character varying(255) NOT NULL,
    file_key character varying(500) NOT NULL,
    file_size bigint,
    mime_type character varying(100),
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE approval_decision_files; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.approval_decision_files IS 'Файлы, прикрепленные к решениям об отклонении заявок на оплату. Используется для хранения пояснительных документов (скриншоты ошибок, расчеты) при отклонении заявки согласующими лицами.';


--
-- Name: COLUMN approval_decision_files.approval_decision_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.approval_decision_files.approval_decision_id IS 'ID решения о согласовании/отклонении из таблицы approval_decisions';


--
-- Name: COLUMN approval_decision_files.file_name; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.approval_decision_files.file_name IS 'Оригинальное имя файла при загрузке';


--
-- Name: COLUMN approval_decision_files.file_key; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.approval_decision_files.file_key IS 'Ключ файла в S3 хранилище. Формат: approval-decisions/{approval_decision_id}/{timestamp}_{filename}';


--
-- Name: COLUMN approval_decision_files.file_size; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.approval_decision_files.file_size IS 'Размер файла в байтах';


--
-- Name: COLUMN approval_decision_files.mime_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.approval_decision_files.mime_type IS 'MIME-тип файла (image/png, application/pdf и т.д.)';


--
-- Name: COLUMN approval_decision_files.created_by; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.approval_decision_files.created_by IS 'ID пользователя, загрузившего файл (согласующее лицо, отклонившее заявку)';


--
-- Name: approval_decisions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.approval_decisions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    payment_request_id uuid NOT NULL,
    stage_order integer NOT NULL,
    department_id public.department_enum NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    user_id uuid,
    comment text DEFAULT ''::text NOT NULL,
    decided_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    is_omts_rp boolean DEFAULT false NOT NULL,
    CONSTRAINT approval_decisions_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])))
);


--
-- Name: comment_read_status; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.comment_read_status (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    payment_request_id uuid NOT NULL,
    last_read_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: construction_sites; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.construction_sites (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: contract_comment_read_status; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contract_comment_read_status (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    contract_request_id uuid NOT NULL,
    last_read_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE contract_comment_read_status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.contract_comment_read_status IS 'Статус прочтения комментариев к заявкам на договоры';


--
-- Name: COLUMN contract_comment_read_status.user_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.contract_comment_read_status.user_id IS 'Пользователь';


--
-- Name: COLUMN contract_comment_read_status.contract_request_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.contract_comment_read_status.contract_request_id IS 'Ссылка на заявку';


--
-- Name: COLUMN contract_comment_read_status.last_read_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.contract_comment_read_status.last_read_at IS 'Дата последнего прочтения';


--
-- Name: contract_request_comments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contract_request_comments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    contract_request_id uuid NOT NULL,
    author_id uuid NOT NULL,
    text text NOT NULL,
    recipient text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone
);


--
-- Name: TABLE contract_request_comments; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.contract_request_comments IS 'Комментарии к заявкам на договоры';


--
-- Name: COLUMN contract_request_comments.contract_request_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.contract_request_comments.contract_request_id IS 'Ссылка на заявку';


--
-- Name: COLUMN contract_request_comments.author_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.contract_request_comments.author_id IS 'Автор комментария';


--
-- Name: COLUMN contract_request_comments.text; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.contract_request_comments.text IS 'Текст комментария';


--
-- Name: COLUMN contract_request_comments.recipient; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.contract_request_comments.recipient IS 'Адресат комментария';


--
-- Name: contract_request_files; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contract_request_files (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    contract_request_id uuid NOT NULL,
    file_name character varying(255) NOT NULL,
    file_key character varying(500) NOT NULL,
    file_size bigint,
    mime_type character varying(100),
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    is_additional boolean DEFAULT false NOT NULL,
    is_rejected boolean DEFAULT false NOT NULL,
    rejected_by uuid,
    rejected_at timestamp with time zone,
    is_signed_contract boolean DEFAULT false NOT NULL
);


--
-- Name: TABLE contract_request_files; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.contract_request_files IS 'Файлы, прикрепленные к заявкам на договоры';


--
-- Name: COLUMN contract_request_files.contract_request_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.contract_request_files.contract_request_id IS 'Ссылка на заявку';


--
-- Name: COLUMN contract_request_files.file_name; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.contract_request_files.file_name IS 'Имя файла';


--
-- Name: COLUMN contract_request_files.file_key; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.contract_request_files.file_key IS 'Ключ файла в S3-хранилище';


--
-- Name: COLUMN contract_request_files.is_additional; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.contract_request_files.is_additional IS 'Признак дополнительного файла';


--
-- Name: COLUMN contract_request_files.is_rejected; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.contract_request_files.is_rejected IS 'Признак отклоненного файла';


--
-- Name: COLUMN contract_request_files.rejected_by; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.contract_request_files.rejected_by IS 'Кто отклонил файл';


--
-- Name: COLUMN contract_request_files.rejected_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.contract_request_files.rejected_at IS 'Дата отклонения файла';


--
-- Name: contract_request_number_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.contract_request_number_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: contract_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contract_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    request_number character varying(20) NOT NULL,
    site_id uuid NOT NULL,
    counterparty_id uuid NOT NULL,
    supplier_id uuid NOT NULL,
    parties_count smallint NOT NULL,
    subject_type character varying(50) NOT NULL,
    subject_detail text,
    status_id uuid NOT NULL,
    revision_targets text[] DEFAULT '{}'::text[] NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    is_deleted boolean DEFAULT false NOT NULL,
    deleted_at timestamp with time zone,
    original_received_at timestamp with time zone,
    status_history jsonb DEFAULT '[]'::jsonb NOT NULL,
    responsible_user_id uuid,
    contract_number text,
    contract_signing_date date,
    CONSTRAINT contract_requests_parties_count_check CHECK ((parties_count = ANY (ARRAY[2, 3, 4]))),
    CONSTRAINT contract_requests_subject_type_check CHECK (((subject_type)::text = ANY ((ARRAY['general'::character varying, 'metal'::character varying, 'non_metallic'::character varying, 'concrete'::character varying])::text[])))
);


--
-- Name: TABLE contract_requests; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.contract_requests IS 'Заявки на заключение договоров';


--
-- Name: COLUMN contract_requests.request_number; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.contract_requests.request_number IS 'Номер заявки в формате Д-YYYY-NNNNN';


--
-- Name: COLUMN contract_requests.site_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.contract_requests.site_id IS 'Объект строительства';


--
-- Name: COLUMN contract_requests.counterparty_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.contract_requests.counterparty_id IS 'Контрагент';


--
-- Name: COLUMN contract_requests.supplier_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.contract_requests.supplier_id IS 'Поставщик';


--
-- Name: COLUMN contract_requests.parties_count; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.contract_requests.parties_count IS 'Количество сторон договора (2, 3 или 4)';


--
-- Name: COLUMN contract_requests.subject_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.contract_requests.subject_type IS 'Тип предмета договора (general, metal, non_metallic, concrete)';


--
-- Name: COLUMN contract_requests.subject_detail; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.contract_requests.subject_detail IS 'Детализация предмета договора';


--
-- Name: COLUMN contract_requests.status_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.contract_requests.status_id IS 'Текущий статус заявки';


--
-- Name: COLUMN contract_requests.revision_targets; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.contract_requests.revision_targets IS 'Адресаты доработки (массив)';


--
-- Name: COLUMN contract_requests.created_by; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.contract_requests.created_by IS 'Автор заявки';


--
-- Name: COLUMN contract_requests.is_deleted; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.contract_requests.is_deleted IS 'Признак мягкого удаления';


--
-- Name: COLUMN contract_requests.deleted_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.contract_requests.deleted_at IS 'Дата мягкого удаления';


--
-- Name: COLUMN contract_requests.original_received_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.contract_requests.original_received_at IS 'Дата получения оригинала договора';


--
-- Name: COLUMN contract_requests.status_history; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.contract_requests.status_history IS 'История изменений статусов заявки';


--
-- Name: cost_types; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cost_types (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: counterparties; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.counterparties (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    inn text DEFAULT ''::text NOT NULL,
    address text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    alternative_names jsonb DEFAULT '[]'::jsonb NOT NULL,
    registration_token uuid DEFAULT gen_random_uuid()
);


--
-- Name: TABLE counterparties; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.counterparties IS 'Справочник контрагентов (без привязки к менеджеру ОМТС)';


--
-- Name: counterparty_security_checks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.counterparty_security_checks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    counterparty_id uuid NOT NULL,
    author_id uuid NOT NULL,
    event_type text NOT NULL,
    comment text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT counterparty_security_checks_event_type_check CHECK ((event_type = ANY (ARRAY['requested'::text, 'approved'::text, 'rejected'::text])))
);


--
-- Name: distribution_letters; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.distribution_letters (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    invoice_id uuid NOT NULL,
    counterparty_id uuid NOT NULL,
    site_id uuid NOT NULL,
    number text DEFAULT ''::text NOT NULL,
    date date,
    total_amount numeric(15,2) DEFAULT 0 NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT distribution_letters_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'pending'::text, 'approved'::text, 'rejected'::text, 'ordered'::text])))
);


--
-- Name: document_types; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.document_types (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    category text DEFAULT 'operational'::text NOT NULL
);


--
-- Name: documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.documents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    counterparty_id uuid NOT NULL,
    document_type_id uuid NOT NULL,
    site_id uuid NOT NULL,
    file_name text DEFAULT ''::text NOT NULL,
    file_key text DEFAULT ''::text NOT NULL,
    uploaded_at timestamp with time zone DEFAULT now() NOT NULL,
    is_marked_for_deletion boolean DEFAULT false NOT NULL,
    marked_for_deletion_at timestamp with time zone
);


--
-- Name: employees; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employees (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    full_name text NOT NULL,
    "position" text DEFAULT ''::text NOT NULL,
    department text DEFAULT ''::text NOT NULL,
    email text DEFAULT ''::text NOT NULL,
    phone text DEFAULT ''::text NOT NULL,
    role text DEFAULT 'viewer'::text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT employees_role_check CHECK ((role = ANY (ARRAY['admin'::text, 'user'::text])))
);


--
-- Name: error_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.error_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    error_type character varying(50) NOT NULL,
    error_message text NOT NULL,
    error_stack text,
    url text,
    user_id uuid,
    user_agent text,
    component character varying(255),
    metadata jsonb
);


--
-- Name: founding_document_files; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.founding_document_files (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    supplier_founding_document_id uuid NOT NULL,
    file_name character varying(255) NOT NULL,
    file_key character varying(500) NOT NULL,
    file_size bigint,
    mime_type character varying(100),
    comment text DEFAULT ''::text NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: invoices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invoices (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    counterparty_id uuid NOT NULL,
    number text DEFAULT ''::text NOT NULL,
    date date,
    total_amount numeric(15,2) DEFAULT 0 NOT NULL,
    status text DEFAULT 'new'::text NOT NULL,
    file_key text DEFAULT ''::text NOT NULL,
    file_name text DEFAULT ''::text NOT NULL,
    ocr_result text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    is_marked_for_deletion boolean DEFAULT false NOT NULL,
    marked_for_deletion_at timestamp with time zone,
    CONSTRAINT invoices_status_check CHECK ((status = ANY (ARRAY['new'::text, 'recognized'::text, 'processed'::text, 'error'::text])))
);


--
-- Name: materials_dictionary; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.materials_dictionary (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    unit text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    type text DEFAULT 'info'::text NOT NULL,
    title text NOT NULL,
    message text NOT NULL,
    user_id uuid NOT NULL,
    is_read boolean DEFAULT false NOT NULL,
    payment_request_id uuid,
    department_id public.department_enum,
    site_id uuid,
    resolved boolean DEFAULT false NOT NULL,
    resolved_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    contract_request_id uuid,
    counterparty_id uuid,
    supplier_id uuid
);


--
-- Name: COLUMN notifications.contract_request_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.notifications.contract_request_id IS 'Ссылка на заявку на договор (для уведомлений по договорам)';


--
-- Name: ocr_models; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ocr_models (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    model_id text NOT NULL,
    is_active boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ocr_recognition_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ocr_recognition_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    payment_request_id uuid NOT NULL,
    file_id uuid,
    model_id text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    error_message text,
    attempt_number integer DEFAULT 1 NOT NULL,
    input_tokens integer,
    output_tokens integer,
    total_cost numeric(15,6),
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone
);


--
-- Name: payment_payment_files; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payment_payment_files (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    payment_payment_id uuid NOT NULL,
    file_name character varying(255) NOT NULL,
    file_key character varying(500) NOT NULL,
    file_size bigint,
    mime_type character varying(100),
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: payment_payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payment_payments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    payment_request_id uuid NOT NULL,
    payment_number integer NOT NULL,
    payment_date date NOT NULL,
    amount numeric(15,2) NOT NULL,
    created_by uuid NOT NULL,
    updated_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone,
    is_executed boolean DEFAULT false NOT NULL
);


--
-- Name: payment_request_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payment_request_assignments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    payment_request_id uuid NOT NULL,
    assigned_user_id uuid NOT NULL,
    assigned_by_user_id uuid NOT NULL,
    assigned_at timestamp with time zone DEFAULT now() NOT NULL,
    is_current boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE payment_request_assignments; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.payment_request_assignments IS 'История назначения ответственных сотрудников ОМТС за заявки';


--
-- Name: COLUMN payment_request_assignments.assigned_by_user_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.payment_request_assignments.assigned_by_user_id IS 'Кто назначил ответственного (admin_omts)';


--
-- Name: COLUMN payment_request_assignments.assigned_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.payment_request_assignments.assigned_at IS 'Дата и время назначения ответственного';


--
-- Name: COLUMN payment_request_assignments.is_current; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.payment_request_assignments.is_current IS 'TRUE только для текущего назначения (одна запись на заявку)';


--
-- Name: payment_request_comments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payment_request_comments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    payment_request_id uuid NOT NULL,
    author_id uuid NOT NULL,
    text text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone,
    recipient text
);


--
-- Name: COLUMN payment_request_comments.recipient; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.payment_request_comments.recipient IS 'Адресат комментария: NULL=Всем, omts=ОМТС, shtab=Штаб, counterparty=Подрядчик';


--
-- Name: payment_request_field_options; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payment_request_field_options (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    field_code character varying(50) NOT NULL,
    value character varying(100) NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    display_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: payment_request_files; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payment_request_files (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    payment_request_id uuid NOT NULL,
    document_type_id uuid NOT NULL,
    file_name character varying(255) NOT NULL,
    file_key character varying(500) NOT NULL,
    file_size bigint,
    mime_type character varying(100),
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    page_count integer,
    is_resubmit boolean DEFAULT false,
    is_additional boolean DEFAULT false NOT NULL,
    is_rejected boolean DEFAULT false NOT NULL,
    rejected_by uuid,
    rejected_at timestamp with time zone
);


--
-- Name: payment_request_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payment_request_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    payment_request_id uuid NOT NULL,
    user_id uuid NOT NULL,
    action text NOT NULL,
    details jsonb,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: payment_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payment_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    request_number character varying(20) NOT NULL,
    counterparty_id uuid NOT NULL,
    status_id uuid NOT NULL,
    delivery_days integer NOT NULL,
    shipping_condition_id uuid NOT NULL,
    comment text,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    withdrawn_at timestamp with time zone,
    site_id uuid NOT NULL,
    total_files integer DEFAULT 0 NOT NULL,
    uploaded_files integer DEFAULT 0 NOT NULL,
    current_stage integer,
    approved_at timestamp with time zone,
    rejected_at timestamp with time zone,
    withdrawal_comment text,
    delivery_days_type text DEFAULT 'working'::text NOT NULL,
    resubmit_comment text,
    resubmit_count integer DEFAULT 0,
    rejected_stage integer,
    invoice_amount numeric(15,2),
    invoice_amount_history jsonb DEFAULT '[]'::jsonb,
    is_deleted boolean DEFAULT false NOT NULL,
    deleted_at timestamp with time zone,
    paid_status_id uuid,
    total_paid numeric(15,2) DEFAULT 0 NOT NULL,
    supplier_id uuid,
    dp_number text,
    dp_date date,
    dp_amount numeric(15,2),
    dp_file_key text,
    dp_file_name text,
    omts_entered_at timestamp with time zone,
    omts_approved_at timestamp with time zone,
    previous_status_id uuid,
    stage_history jsonb DEFAULT '[]'::jsonb,
    cost_type_id uuid,
    materials_verification jsonb,
    closed_at timestamp with time zone
);


--
-- Name: COLUMN payment_requests.rejected_stage; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.payment_requests.rejected_stage IS 'Номер этапа (1=Штаб, 2=ОМТС), на котором была отклонена заявка';


--
-- Name: COLUMN payment_requests.invoice_amount; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.payment_requests.invoice_amount IS 'Сумма счета в рублях';


--
-- Name: COLUMN payment_requests.invoice_amount_history; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.payment_requests.invoice_amount_history IS 'Массив записей об изменении суммы при повторных отправках. Формат: [{"amount": число, "changedAt": "ISO-дата"}, ...]';


--
-- Name: recognized_materials; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.recognized_materials (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    payment_request_id uuid NOT NULL,
    file_id uuid,
    material_id uuid NOT NULL,
    page_number integer,
    "position" integer NOT NULL,
    article text,
    quantity numeric(15,4),
    price numeric(15,2),
    amount numeric(15,2),
    estimate_quantity numeric(15,4),
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: request_number_sequence; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.request_number_sequence (
    year integer NOT NULL,
    last_number integer DEFAULT 0 NOT NULL
);


--
-- Name: settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.settings (
    key text NOT NULL,
    value jsonb DEFAULT '{}'::jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: site_required_documents_mapping; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.site_required_documents_mapping (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    site_id uuid NOT NULL,
    document_type_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: specifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.specifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    invoice_id uuid NOT NULL,
    "position" integer DEFAULT 1 NOT NULL,
    name text DEFAULT ''::text NOT NULL,
    unit text DEFAULT ''::text NOT NULL,
    quantity numeric(15,4) DEFAULT 0 NOT NULL,
    price numeric(15,2) DEFAULT 0 NOT NULL,
    amount numeric(15,2) DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: statuses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.statuses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    entity_type character varying(50) NOT NULL,
    code character varying(50) NOT NULL,
    name character varying(100) NOT NULL,
    color character varying(20),
    is_active boolean DEFAULT true NOT NULL,
    display_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    visible_roles text[] DEFAULT '{}'::text[] NOT NULL
);


--
-- Name: supplier_founding_documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.supplier_founding_documents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    supplier_id uuid NOT NULL,
    founding_document_type_id uuid NOT NULL,
    is_available boolean DEFAULT false NOT NULL,
    checked_by uuid,
    checked_at timestamp with time zone,
    comment text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: supplier_security_checks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.supplier_security_checks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    supplier_id uuid NOT NULL,
    author_id uuid NOT NULL,
    event_type text NOT NULL,
    comment text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT supplier_security_checks_event_type_check CHECK ((event_type = ANY (ARRAY['requested'::text, 'approved'::text, 'rejected'::text])))
);


--
-- Name: suppliers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.suppliers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    inn text NOT NULL,
    alternative_names jsonb DEFAULT '[]'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    founding_documents_comment text,
    last_security_status text,
    CONSTRAINT suppliers_last_security_status_check CHECK ((last_security_status = ANY (ARRAY['approved'::text, 'rejected'::text])))
);


--
-- Name: upload_tasks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.upload_tasks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    type text NOT NULL,
    entity_id uuid NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    total_files integer DEFAULT 0 NOT NULL,
    uploaded_files integer DEFAULT 0 NOT NULL,
    error_message text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT upload_tasks_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'processing'::text, 'completed'::text, 'error'::text]))),
    CONSTRAINT upload_tasks_type_check CHECK ((type = ANY (ARRAY['request_files'::text, 'decision_files'::text, 'contract_files'::text, 'payment_files'::text])))
);


--
-- Name: user_construction_sites_mapping; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_construction_sites_mapping (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    construction_site_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id uuid NOT NULL,
    email text NOT NULL,
    role text DEFAULT 'viewer'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    counterparty_id uuid,
    department_id public.department_enum,
    all_sites boolean DEFAULT false NOT NULL,
    full_name text DEFAULT ''::text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    CONSTRAINT users_role_check CHECK ((role = ANY (ARRAY['admin'::text, 'user'::text, 'counterparty_user'::text, 'security'::text])))
);


--
-- Name: COLUMN users.role; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.users.role IS 'Роль: admin (полный доступ), user (сотрудник), counterparty_user (подрядчик)';


--
-- Name: approval_decision_files approval_decision_files_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.approval_decision_files
    ADD CONSTRAINT approval_decision_files_pkey PRIMARY KEY (id);


--
-- Name: approval_decisions approval_decisions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.approval_decisions
    ADD CONSTRAINT approval_decisions_pkey PRIMARY KEY (id);


--
-- Name: comment_read_status comment_read_status_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comment_read_status
    ADD CONSTRAINT comment_read_status_pkey PRIMARY KEY (id);


--
-- Name: comment_read_status comment_read_status_user_id_payment_request_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comment_read_status
    ADD CONSTRAINT comment_read_status_user_id_payment_request_id_key UNIQUE (user_id, payment_request_id);


--
-- Name: construction_sites construction_sites_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.construction_sites
    ADD CONSTRAINT construction_sites_pkey PRIMARY KEY (id);


--
-- Name: contract_comment_read_status contract_comment_read_status_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_comment_read_status
    ADD CONSTRAINT contract_comment_read_status_pkey PRIMARY KEY (id);


--
-- Name: contract_request_comments contract_request_comments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_request_comments
    ADD CONSTRAINT contract_request_comments_pkey PRIMARY KEY (id);


--
-- Name: contract_request_files contract_request_files_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_request_files
    ADD CONSTRAINT contract_request_files_pkey PRIMARY KEY (id);


--
-- Name: contract_requests contract_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_requests
    ADD CONSTRAINT contract_requests_pkey PRIMARY KEY (id);


--
-- Name: cost_types cost_types_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cost_types
    ADD CONSTRAINT cost_types_pkey PRIMARY KEY (id);


--
-- Name: counterparties counterparties_inn_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.counterparties
    ADD CONSTRAINT counterparties_inn_unique UNIQUE (inn);


--
-- Name: counterparties counterparties_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.counterparties
    ADD CONSTRAINT counterparties_pkey PRIMARY KEY (id);


--
-- Name: counterparties counterparties_registration_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.counterparties
    ADD CONSTRAINT counterparties_registration_token_key UNIQUE (registration_token);


--
-- Name: counterparty_security_checks counterparty_security_checks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.counterparty_security_checks
    ADD CONSTRAINT counterparty_security_checks_pkey PRIMARY KEY (id);


--
-- Name: distribution_letters distribution_letters_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.distribution_letters
    ADD CONSTRAINT distribution_letters_pkey PRIMARY KEY (id);


--
-- Name: document_types document_types_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_types
    ADD CONSTRAINT document_types_pkey PRIMARY KEY (id);


--
-- Name: documents documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_pkey PRIMARY KEY (id);


--
-- Name: employees employees_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employees
    ADD CONSTRAINT employees_pkey PRIMARY KEY (id);


--
-- Name: error_logs error_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.error_logs
    ADD CONSTRAINT error_logs_pkey PRIMARY KEY (id);


--
-- Name: founding_document_files founding_document_files_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.founding_document_files
    ADD CONSTRAINT founding_document_files_pkey PRIMARY KEY (id);


--
-- Name: invoices invoices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_pkey PRIMARY KEY (id);


--
-- Name: materials_dictionary materials_dictionary_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.materials_dictionary
    ADD CONSTRAINT materials_dictionary_pkey PRIMARY KEY (id);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- Name: ocr_models ocr_models_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ocr_models
    ADD CONSTRAINT ocr_models_pkey PRIMARY KEY (id);


--
-- Name: ocr_recognition_log ocr_recognition_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ocr_recognition_log
    ADD CONSTRAINT ocr_recognition_log_pkey PRIMARY KEY (id);


--
-- Name: payment_payment_files payment_payment_files_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_payment_files
    ADD CONSTRAINT payment_payment_files_pkey PRIMARY KEY (id);


--
-- Name: payment_payments payment_payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_payments
    ADD CONSTRAINT payment_payments_pkey PRIMARY KEY (id);


--
-- Name: payment_request_assignments payment_request_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_request_assignments
    ADD CONSTRAINT payment_request_assignments_pkey PRIMARY KEY (id);


--
-- Name: payment_request_comments payment_request_comments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_request_comments
    ADD CONSTRAINT payment_request_comments_pkey PRIMARY KEY (id);


--
-- Name: payment_request_field_options payment_request_field_options_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_request_field_options
    ADD CONSTRAINT payment_request_field_options_pkey PRIMARY KEY (id);


--
-- Name: payment_request_files payment_request_files_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_request_files
    ADD CONSTRAINT payment_request_files_pkey PRIMARY KEY (id);


--
-- Name: payment_request_logs payment_request_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_request_logs
    ADD CONSTRAINT payment_request_logs_pkey PRIMARY KEY (id);


--
-- Name: payment_requests payment_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_requests
    ADD CONSTRAINT payment_requests_pkey PRIMARY KEY (id);


--
-- Name: payment_requests payment_requests_request_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_requests
    ADD CONSTRAINT payment_requests_request_number_key UNIQUE (request_number);


--
-- Name: recognized_materials recognized_materials_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recognized_materials
    ADD CONSTRAINT recognized_materials_pkey PRIMARY KEY (id);


--
-- Name: request_number_sequence request_number_sequence_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.request_number_sequence
    ADD CONSTRAINT request_number_sequence_pkey PRIMARY KEY (year);


--
-- Name: settings settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settings
    ADD CONSTRAINT settings_pkey PRIMARY KEY (key);


--
-- Name: site_required_documents_mapping site_required_documents_mapping_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.site_required_documents_mapping
    ADD CONSTRAINT site_required_documents_mapping_pkey PRIMARY KEY (id);


--
-- Name: site_required_documents_mapping site_required_documents_mapping_site_id_document_type_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.site_required_documents_mapping
    ADD CONSTRAINT site_required_documents_mapping_site_id_document_type_id_key UNIQUE (site_id, document_type_id);


--
-- Name: specifications specifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.specifications
    ADD CONSTRAINT specifications_pkey PRIMARY KEY (id);


--
-- Name: statuses statuses_entity_code_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.statuses
    ADD CONSTRAINT statuses_entity_code_unique UNIQUE (entity_type, code);


--
-- Name: statuses statuses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.statuses
    ADD CONSTRAINT statuses_pkey PRIMARY KEY (id);


--
-- Name: supplier_founding_documents supplier_founding_documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_founding_documents
    ADD CONSTRAINT supplier_founding_documents_pkey PRIMARY KEY (id);


--
-- Name: supplier_founding_documents supplier_founding_documents_supplier_id_founding_document_t_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_founding_documents
    ADD CONSTRAINT supplier_founding_documents_supplier_id_founding_document_t_key UNIQUE (supplier_id, founding_document_type_id);


--
-- Name: supplier_security_checks supplier_security_checks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_security_checks
    ADD CONSTRAINT supplier_security_checks_pkey PRIMARY KEY (id);


--
-- Name: suppliers suppliers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.suppliers
    ADD CONSTRAINT suppliers_pkey PRIMARY KEY (id);


--
-- Name: upload_tasks upload_tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.upload_tasks
    ADD CONSTRAINT upload_tasks_pkey PRIMARY KEY (id);


--
-- Name: user_construction_sites_mapping user_construction_sites_mappin_user_id_construction_site_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_construction_sites_mapping
    ADD CONSTRAINT user_construction_sites_mappin_user_id_construction_site_id_key UNIQUE (user_id, construction_site_id);


--
-- Name: user_construction_sites_mapping user_construction_sites_mapping_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_construction_sites_mapping
    ADD CONSTRAINT user_construction_sites_mapping_pkey PRIMARY KEY (id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: approval_decisions_unique_pending_stage; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX approval_decisions_unique_pending_stage ON public.approval_decisions USING btree (payment_request_id, stage_order, department_id, is_omts_rp) WHERE (status = 'pending'::text);


--
-- Name: idx_ad_files_decision; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ad_files_decision ON public.approval_decision_files USING btree (approval_decision_id);


--
-- Name: idx_approval_decisions_department; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_approval_decisions_department ON public.approval_decisions USING btree (department_id);


--
-- Name: idx_approval_decisions_request; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_approval_decisions_request ON public.approval_decisions USING btree (payment_request_id);


--
-- Name: idx_approval_decisions_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_approval_decisions_status ON public.approval_decisions USING btree (status);


--
-- Name: idx_assignments_current; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_assignments_current ON public.payment_request_assignments USING btree (payment_request_id, is_current) WHERE (is_current = true);


--
-- Name: idx_assignments_request; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_assignments_request ON public.payment_request_assignments USING btree (payment_request_id, assigned_at DESC);


--
-- Name: idx_assignments_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_assignments_user ON public.payment_request_assignments USING btree (assigned_user_id, is_current) WHERE (is_current = true);


--
-- Name: idx_comment_read_status_request; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_comment_read_status_request ON public.comment_read_status USING btree (payment_request_id);


--
-- Name: idx_comment_read_status_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_comment_read_status_user ON public.comment_read_status USING btree (user_id);


--
-- Name: idx_contract_comment_read_status_user_request; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_contract_comment_read_status_user_request ON public.contract_comment_read_status USING btree (user_id, contract_request_id);


--
-- Name: idx_contract_request_comments_request_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contract_request_comments_request_created ON public.contract_request_comments USING btree (contract_request_id, created_at);


--
-- Name: idx_contract_request_files_request_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contract_request_files_request_id ON public.contract_request_files USING btree (contract_request_id);


--
-- Name: idx_contract_requests_counterparty_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contract_requests_counterparty_id ON public.contract_requests USING btree (counterparty_id);


--
-- Name: idx_contract_requests_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contract_requests_created_at ON public.contract_requests USING btree (created_at DESC);


--
-- Name: idx_contract_requests_not_deleted; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contract_requests_not_deleted ON public.contract_requests USING btree (id) WHERE (is_deleted = false);


--
-- Name: idx_contract_requests_site_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contract_requests_site_id ON public.contract_requests USING btree (site_id);


--
-- Name: idx_contract_requests_status_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contract_requests_status_id ON public.contract_requests USING btree (status_id);


--
-- Name: idx_contract_requests_supplier_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contract_requests_supplier_id ON public.contract_requests USING btree (supplier_id);


--
-- Name: idx_cp_sb_checks_author; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cp_sb_checks_author ON public.counterparty_security_checks USING btree (author_id);


--
-- Name: idx_cp_sb_checks_counterparty_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cp_sb_checks_counterparty_created ON public.counterparty_security_checks USING btree (counterparty_id, created_at DESC);


--
-- Name: idx_cr_responsible_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cr_responsible_user_id ON public.contract_requests USING btree (responsible_user_id);


--
-- Name: idx_distribution_letters_counterparty_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_distribution_letters_counterparty_id ON public.distribution_letters USING btree (counterparty_id);


--
-- Name: idx_distribution_letters_invoice_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_distribution_letters_invoice_id ON public.distribution_letters USING btree (invoice_id);


--
-- Name: idx_distribution_letters_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_distribution_letters_status ON public.distribution_letters USING btree (status);


--
-- Name: idx_documents_counterparty_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_documents_counterparty_id ON public.documents USING btree (counterparty_id);


--
-- Name: idx_documents_site_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_documents_site_id ON public.documents USING btree (site_id);


--
-- Name: idx_error_logs_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_error_logs_created_at ON public.error_logs USING btree (created_at DESC);


--
-- Name: idx_error_logs_error_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_error_logs_error_type ON public.error_logs USING btree (error_type);


--
-- Name: idx_error_logs_type_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_error_logs_type_created ON public.error_logs USING btree (error_type, created_at DESC);


--
-- Name: idx_error_logs_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_error_logs_user_id ON public.error_logs USING btree (user_id);


--
-- Name: idx_fdf_sfd_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fdf_sfd_id ON public.founding_document_files USING btree (supplier_founding_document_id);


--
-- Name: idx_invoices_counterparty_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invoices_counterparty_id ON public.invoices USING btree (counterparty_id);


--
-- Name: idx_invoices_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invoices_status ON public.invoices USING btree (status);


--
-- Name: idx_materials_dictionary_name_unit; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_materials_dictionary_name_unit ON public.materials_dictionary USING btree (name, COALESCE(unit, ''::text));


--
-- Name: idx_notifications_counterparty; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_counterparty ON public.notifications USING btree (counterparty_id);


--
-- Name: idx_notifications_supplier; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_supplier ON public.notifications USING btree (supplier_id);


--
-- Name: idx_notifications_unread; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_unread ON public.notifications USING btree (user_id, is_read) WHERE (is_read = false);


--
-- Name: idx_notifications_unresolved; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_unresolved ON public.notifications USING btree (resolved, department_id, site_id) WHERE (resolved = false);


--
-- Name: idx_notifications_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_user ON public.notifications USING btree (user_id);


--
-- Name: idx_ocr_recognition_log_request; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ocr_recognition_log_request ON public.ocr_recognition_log USING btree (payment_request_id);


--
-- Name: idx_ocr_recognition_log_started_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ocr_recognition_log_started_at ON public.ocr_recognition_log USING btree (started_at);


--
-- Name: idx_payment_payment_files_payment; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payment_payment_files_payment ON public.payment_payment_files USING btree (payment_payment_id);


--
-- Name: idx_payment_payments_request; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payment_payments_request ON public.payment_payments USING btree (payment_request_id);


--
-- Name: idx_payment_requests_is_deleted; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payment_requests_is_deleted ON public.payment_requests USING btree (is_deleted);


--
-- Name: idx_pr_comments_author; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pr_comments_author ON public.payment_request_comments USING btree (author_id);


--
-- Name: idx_pr_comments_request; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pr_comments_request ON public.payment_request_comments USING btree (payment_request_id);


--
-- Name: idx_pr_counterparty; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pr_counterparty ON public.payment_requests USING btree (counterparty_id);


--
-- Name: idx_pr_created_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pr_created_by ON public.payment_requests USING btree (created_by);


--
-- Name: idx_pr_field_options_field_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pr_field_options_field_code ON public.payment_request_field_options USING btree (field_code);


--
-- Name: idx_pr_files_request; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pr_files_request ON public.payment_request_files USING btree (payment_request_id);


--
-- Name: idx_pr_logs_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pr_logs_created ON public.payment_request_logs USING btree (created_at);


--
-- Name: idx_pr_logs_request; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pr_logs_request ON public.payment_request_logs USING btree (payment_request_id);


--
-- Name: idx_pr_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pr_status ON public.payment_requests USING btree (status_id);


--
-- Name: idx_recognized_materials_material; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_recognized_materials_material ON public.recognized_materials USING btree (material_id);


--
-- Name: idx_recognized_materials_request; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_recognized_materials_request ON public.recognized_materials USING btree (payment_request_id);


--
-- Name: idx_sfd_supplier_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sfd_supplier_id ON public.supplier_founding_documents USING btree (supplier_id);


--
-- Name: idx_sfd_type_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sfd_type_id ON public.supplier_founding_documents USING btree (founding_document_type_id);


--
-- Name: idx_site_required_docs_site_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_site_required_docs_site_id ON public.site_required_documents_mapping USING btree (site_id);


--
-- Name: idx_specifications_invoice_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_specifications_invoice_id ON public.specifications USING btree (invoice_id);


--
-- Name: idx_statuses_entity_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_statuses_entity_type ON public.statuses USING btree (entity_type);


--
-- Name: idx_sup_sb_checks_author; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sup_sb_checks_author ON public.supplier_security_checks USING btree (author_id);


--
-- Name: idx_sup_sb_checks_supplier_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sup_sb_checks_supplier_created ON public.supplier_security_checks USING btree (supplier_id, created_at DESC);


--
-- Name: idx_upload_tasks_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_upload_tasks_entity ON public.upload_tasks USING btree (entity_id);


--
-- Name: idx_upload_tasks_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_upload_tasks_status ON public.upload_tasks USING btree (status) WHERE (status = ANY (ARRAY['pending'::text, 'processing'::text]));


--
-- Name: idx_user_sites_site; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_sites_site ON public.user_construction_sites_mapping USING btree (construction_site_id);


--
-- Name: idx_user_sites_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_sites_user ON public.user_construction_sites_mapping USING btree (user_id);


--
-- Name: suppliers_inn_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX suppliers_inn_unique ON public.suppliers USING btree (inn);


--
-- Name: approval_decisions approval_decisions_payment_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.approval_decisions
    ADD CONSTRAINT approval_decisions_payment_request_id_fkey FOREIGN KEY (payment_request_id) REFERENCES public.payment_requests(id) ON DELETE CASCADE;


--
-- Name: approval_decisions approval_decisions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.approval_decisions
    ADD CONSTRAINT approval_decisions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: comment_read_status comment_read_status_payment_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comment_read_status
    ADD CONSTRAINT comment_read_status_payment_request_id_fkey FOREIGN KEY (payment_request_id) REFERENCES public.payment_requests(id) ON DELETE CASCADE;


--
-- Name: comment_read_status comment_read_status_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comment_read_status
    ADD CONSTRAINT comment_read_status_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: contract_comment_read_status contract_comment_read_status_contract_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_comment_read_status
    ADD CONSTRAINT contract_comment_read_status_contract_request_id_fkey FOREIGN KEY (contract_request_id) REFERENCES public.contract_requests(id) ON DELETE CASCADE;


--
-- Name: contract_comment_read_status contract_comment_read_status_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_comment_read_status
    ADD CONSTRAINT contract_comment_read_status_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: contract_request_comments contract_request_comments_author_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_request_comments
    ADD CONSTRAINT contract_request_comments_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.users(id);


--
-- Name: contract_request_comments contract_request_comments_contract_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_request_comments
    ADD CONSTRAINT contract_request_comments_contract_request_id_fkey FOREIGN KEY (contract_request_id) REFERENCES public.contract_requests(id) ON DELETE CASCADE;


--
-- Name: contract_request_files contract_request_files_contract_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_request_files
    ADD CONSTRAINT contract_request_files_contract_request_id_fkey FOREIGN KEY (contract_request_id) REFERENCES public.contract_requests(id) ON DELETE CASCADE;


--
-- Name: contract_request_files contract_request_files_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_request_files
    ADD CONSTRAINT contract_request_files_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: contract_request_files contract_request_files_rejected_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_request_files
    ADD CONSTRAINT contract_request_files_rejected_by_fkey FOREIGN KEY (rejected_by) REFERENCES public.users(id);


--
-- Name: contract_requests contract_requests_counterparty_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_requests
    ADD CONSTRAINT contract_requests_counterparty_id_fkey FOREIGN KEY (counterparty_id) REFERENCES public.counterparties(id);


--
-- Name: contract_requests contract_requests_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_requests
    ADD CONSTRAINT contract_requests_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: contract_requests contract_requests_responsible_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_requests
    ADD CONSTRAINT contract_requests_responsible_user_id_fkey FOREIGN KEY (responsible_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: contract_requests contract_requests_site_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_requests
    ADD CONSTRAINT contract_requests_site_id_fkey FOREIGN KEY (site_id) REFERENCES public.construction_sites(id);


--
-- Name: contract_requests contract_requests_status_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_requests
    ADD CONSTRAINT contract_requests_status_id_fkey FOREIGN KEY (status_id) REFERENCES public.statuses(id);


--
-- Name: contract_requests contract_requests_supplier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_requests
    ADD CONSTRAINT contract_requests_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id);


--
-- Name: counterparty_security_checks counterparty_security_checks_author_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.counterparty_security_checks
    ADD CONSTRAINT counterparty_security_checks_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: counterparty_security_checks counterparty_security_checks_counterparty_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.counterparty_security_checks
    ADD CONSTRAINT counterparty_security_checks_counterparty_id_fkey FOREIGN KEY (counterparty_id) REFERENCES public.counterparties(id) ON DELETE CASCADE;


--
-- Name: distribution_letters distribution_letters_counterparty_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.distribution_letters
    ADD CONSTRAINT distribution_letters_counterparty_id_fkey FOREIGN KEY (counterparty_id) REFERENCES public.counterparties(id) ON DELETE CASCADE;


--
-- Name: distribution_letters distribution_letters_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.distribution_letters
    ADD CONSTRAINT distribution_letters_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.invoices(id) ON DELETE CASCADE;


--
-- Name: distribution_letters distribution_letters_site_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.distribution_letters
    ADD CONSTRAINT distribution_letters_site_id_fkey FOREIGN KEY (site_id) REFERENCES public.construction_sites(id) ON DELETE RESTRICT;


--
-- Name: documents documents_counterparty_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_counterparty_id_fkey FOREIGN KEY (counterparty_id) REFERENCES public.counterparties(id) ON DELETE CASCADE;


--
-- Name: documents documents_document_type_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_document_type_id_fkey FOREIGN KEY (document_type_id) REFERENCES public.document_types(id) ON DELETE RESTRICT;


--
-- Name: documents documents_site_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_site_id_fkey FOREIGN KEY (site_id) REFERENCES public.construction_sites(id) ON DELETE RESTRICT;


--
-- Name: error_logs error_logs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.error_logs
    ADD CONSTRAINT error_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: approval_decision_files fk_approval_decision; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.approval_decision_files
    ADD CONSTRAINT fk_approval_decision FOREIGN KEY (approval_decision_id) REFERENCES public.approval_decisions(id) ON DELETE CASCADE;


--
-- Name: approval_decision_files fk_created_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.approval_decision_files
    ADD CONSTRAINT fk_created_by FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: founding_document_files founding_document_files_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.founding_document_files
    ADD CONSTRAINT founding_document_files_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: founding_document_files founding_document_files_supplier_founding_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.founding_document_files
    ADD CONSTRAINT founding_document_files_supplier_founding_document_id_fkey FOREIGN KEY (supplier_founding_document_id) REFERENCES public.supplier_founding_documents(id) ON DELETE CASCADE;


--
-- Name: invoices invoices_counterparty_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_counterparty_id_fkey FOREIGN KEY (counterparty_id) REFERENCES public.counterparties(id) ON DELETE CASCADE;


--
-- Name: notifications notifications_contract_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_contract_request_id_fkey FOREIGN KEY (contract_request_id) REFERENCES public.contract_requests(id);


--
-- Name: notifications notifications_counterparty_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_counterparty_id_fkey FOREIGN KEY (counterparty_id) REFERENCES public.counterparties(id) ON DELETE CASCADE;


--
-- Name: notifications notifications_payment_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_payment_request_id_fkey FOREIGN KEY (payment_request_id) REFERENCES public.payment_requests(id) ON DELETE CASCADE;


--
-- Name: notifications notifications_site_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_site_id_fkey FOREIGN KEY (site_id) REFERENCES public.construction_sites(id);


--
-- Name: notifications notifications_supplier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id) ON DELETE CASCADE;


--
-- Name: notifications notifications_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: ocr_recognition_log ocr_recognition_log_file_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ocr_recognition_log
    ADD CONSTRAINT ocr_recognition_log_file_id_fkey FOREIGN KEY (file_id) REFERENCES public.payment_request_files(id);


--
-- Name: ocr_recognition_log ocr_recognition_log_payment_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ocr_recognition_log
    ADD CONSTRAINT ocr_recognition_log_payment_request_id_fkey FOREIGN KEY (payment_request_id) REFERENCES public.payment_requests(id);


--
-- Name: payment_payment_files payment_payment_files_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_payment_files
    ADD CONSTRAINT payment_payment_files_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: payment_payment_files payment_payment_files_payment_payment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_payment_files
    ADD CONSTRAINT payment_payment_files_payment_payment_id_fkey FOREIGN KEY (payment_payment_id) REFERENCES public.payment_payments(id) ON DELETE CASCADE;


--
-- Name: payment_payments payment_payments_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_payments
    ADD CONSTRAINT payment_payments_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: payment_payments payment_payments_payment_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_payments
    ADD CONSTRAINT payment_payments_payment_request_id_fkey FOREIGN KEY (payment_request_id) REFERENCES public.payment_requests(id);


--
-- Name: payment_payments payment_payments_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_payments
    ADD CONSTRAINT payment_payments_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id);


--
-- Name: payment_request_assignments payment_request_assignments_assigned_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_request_assignments
    ADD CONSTRAINT payment_request_assignments_assigned_by_user_id_fkey FOREIGN KEY (assigned_by_user_id) REFERENCES public.users(id);


--
-- Name: payment_request_assignments payment_request_assignments_assigned_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_request_assignments
    ADD CONSTRAINT payment_request_assignments_assigned_user_id_fkey FOREIGN KEY (assigned_user_id) REFERENCES public.users(id);


--
-- Name: payment_request_assignments payment_request_assignments_payment_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_request_assignments
    ADD CONSTRAINT payment_request_assignments_payment_request_id_fkey FOREIGN KEY (payment_request_id) REFERENCES public.payment_requests(id) ON DELETE CASCADE;


--
-- Name: payment_request_comments payment_request_comments_author_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_request_comments
    ADD CONSTRAINT payment_request_comments_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.users(id);


--
-- Name: payment_request_comments payment_request_comments_payment_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_request_comments
    ADD CONSTRAINT payment_request_comments_payment_request_id_fkey FOREIGN KEY (payment_request_id) REFERENCES public.payment_requests(id) ON DELETE CASCADE;


--
-- Name: payment_request_files payment_request_files_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_request_files
    ADD CONSTRAINT payment_request_files_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: payment_request_files payment_request_files_document_type_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_request_files
    ADD CONSTRAINT payment_request_files_document_type_id_fkey FOREIGN KEY (document_type_id) REFERENCES public.document_types(id);


--
-- Name: payment_request_files payment_request_files_payment_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_request_files
    ADD CONSTRAINT payment_request_files_payment_request_id_fkey FOREIGN KEY (payment_request_id) REFERENCES public.payment_requests(id) ON DELETE CASCADE;


--
-- Name: payment_request_files payment_request_files_rejected_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_request_files
    ADD CONSTRAINT payment_request_files_rejected_by_fkey FOREIGN KEY (rejected_by) REFERENCES public.users(id);


--
-- Name: payment_request_logs payment_request_logs_payment_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_request_logs
    ADD CONSTRAINT payment_request_logs_payment_request_id_fkey FOREIGN KEY (payment_request_id) REFERENCES public.payment_requests(id) ON DELETE CASCADE;


--
-- Name: payment_request_logs payment_request_logs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_request_logs
    ADD CONSTRAINT payment_request_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: payment_requests payment_requests_cost_type_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_requests
    ADD CONSTRAINT payment_requests_cost_type_id_fkey FOREIGN KEY (cost_type_id) REFERENCES public.cost_types(id);


--
-- Name: payment_requests payment_requests_counterparty_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_requests
    ADD CONSTRAINT payment_requests_counterparty_id_fkey FOREIGN KEY (counterparty_id) REFERENCES public.counterparties(id) ON DELETE CASCADE;


--
-- Name: payment_requests payment_requests_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_requests
    ADD CONSTRAINT payment_requests_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: payment_requests payment_requests_paid_status_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_requests
    ADD CONSTRAINT payment_requests_paid_status_id_fkey FOREIGN KEY (paid_status_id) REFERENCES public.statuses(id);


--
-- Name: payment_requests payment_requests_previous_status_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_requests
    ADD CONSTRAINT payment_requests_previous_status_id_fkey FOREIGN KEY (previous_status_id) REFERENCES public.statuses(id);


--
-- Name: payment_requests payment_requests_shipping_condition_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_requests
    ADD CONSTRAINT payment_requests_shipping_condition_id_fkey FOREIGN KEY (shipping_condition_id) REFERENCES public.payment_request_field_options(id);


--
-- Name: payment_requests payment_requests_site_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_requests
    ADD CONSTRAINT payment_requests_site_id_fkey FOREIGN KEY (site_id) REFERENCES public.construction_sites(id);


--
-- Name: payment_requests payment_requests_status_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_requests
    ADD CONSTRAINT payment_requests_status_id_fkey FOREIGN KEY (status_id) REFERENCES public.statuses(id);


--
-- Name: payment_requests payment_requests_supplier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_requests
    ADD CONSTRAINT payment_requests_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id);


--
-- Name: recognized_materials recognized_materials_file_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recognized_materials
    ADD CONSTRAINT recognized_materials_file_id_fkey FOREIGN KEY (file_id) REFERENCES public.payment_request_files(id);


--
-- Name: recognized_materials recognized_materials_material_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recognized_materials
    ADD CONSTRAINT recognized_materials_material_id_fkey FOREIGN KEY (material_id) REFERENCES public.materials_dictionary(id);


--
-- Name: recognized_materials recognized_materials_payment_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recognized_materials
    ADD CONSTRAINT recognized_materials_payment_request_id_fkey FOREIGN KEY (payment_request_id) REFERENCES public.payment_requests(id);


--
-- Name: site_required_documents_mapping site_required_documents_mapping_document_type_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.site_required_documents_mapping
    ADD CONSTRAINT site_required_documents_mapping_document_type_id_fkey FOREIGN KEY (document_type_id) REFERENCES public.document_types(id) ON DELETE CASCADE;


--
-- Name: site_required_documents_mapping site_required_documents_mapping_site_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.site_required_documents_mapping
    ADD CONSTRAINT site_required_documents_mapping_site_id_fkey FOREIGN KEY (site_id) REFERENCES public.construction_sites(id) ON DELETE CASCADE;


--
-- Name: specifications specifications_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.specifications
    ADD CONSTRAINT specifications_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.invoices(id) ON DELETE CASCADE;


--
-- Name: supplier_founding_documents supplier_founding_documents_checked_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_founding_documents
    ADD CONSTRAINT supplier_founding_documents_checked_by_fkey FOREIGN KEY (checked_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: supplier_founding_documents supplier_founding_documents_founding_document_type_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_founding_documents
    ADD CONSTRAINT supplier_founding_documents_founding_document_type_id_fkey FOREIGN KEY (founding_document_type_id) REFERENCES public.document_types(id) ON DELETE CASCADE;


--
-- Name: supplier_founding_documents supplier_founding_documents_supplier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_founding_documents
    ADD CONSTRAINT supplier_founding_documents_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id) ON DELETE CASCADE;


--
-- Name: supplier_security_checks supplier_security_checks_author_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_security_checks
    ADD CONSTRAINT supplier_security_checks_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: supplier_security_checks supplier_security_checks_supplier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_security_checks
    ADD CONSTRAINT supplier_security_checks_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id) ON DELETE CASCADE;


--
-- Name: upload_tasks upload_tasks_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.upload_tasks
    ADD CONSTRAINT upload_tasks_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: user_construction_sites_mapping user_construction_sites_mapping_construction_site_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_construction_sites_mapping
    ADD CONSTRAINT user_construction_sites_mapping_construction_site_id_fkey FOREIGN KEY (construction_site_id) REFERENCES public.construction_sites(id) ON DELETE CASCADE;


--
-- Name: user_construction_sites_mapping user_construction_sites_mapping_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_construction_sites_mapping
    ADD CONSTRAINT user_construction_sites_mapping_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: users users_counterparty_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_counterparty_id_fkey FOREIGN KEY (counterparty_id) REFERENCES public.counterparties(id) ON DELETE SET NULL;


--
-- Name: users users_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict zKXyHovnLjDM6aIzMh29ZFKG5dE1b9NgBxGa2RSkFK4wwC84My0oorECXK8T063

