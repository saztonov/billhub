-- Миграция 0002: outbox + audit_log (партиционирование по месяцам) + jobs_log
-- (стандарт v3 разделы 16/22, план Iteration 7).
--
-- Финальная архитектура миграций (план Iteration 6 примечание): 0001 уже применена,
-- 0002 — следующая инкрементальная. Без top-level BEGIN/COMMIT — execute-миграцию runner
-- оборачивает в транзакцию сам (ADR-0002; иначе TransactionControlError). Идемпотентность
-- через IF NOT EXISTS. Все DDL транзакционны (включая DO-блок создания партиций).
--
-- Что добавляется:
--   1. outbox      — transactional outbox (надёжная публикация бизнес-событий, раздел 16).
--   2. audit_log   — журнал security/admin-событий, PARTITION BY RANGE (created_at) по месяцам
--                    (раздел 22). БЕЗ секретов (токены/пароли/presigned-URL/ПДн не пишутся).
--   3. jobs_log    — отчётность по BullMQ-задачам (для алертов на dead jobs, раздел 21).
--
-- Расширения: gen_random_uuid() доступна (используется во всех PK-дефолтах схемы).
--
-- ПРИМЕЧАНИЕ по audit_log: таблица БЕЗ PRIMARY KEY (append-only). PK на партиционированной
-- таблице обязан включать ключ партиционирования (created_at) — это дало бы составной PK,
-- которого в схеме больше нигде нет (и который не различает drift-fingerprint). Поиск ведётся
-- по индексам (actor_user_id|event_type, created_at DESC); id — суррогат с DEFAULT.

-- 1. outbox -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.outbox (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aggregate_type text        NOT NULL,
  aggregate_id   uuid        NOT NULL,
  event_type     text        NOT NULL,
  payload        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now(),
  processed_at   timestamptz NULL
);

-- Индекс диспетчера: непрочитанные (processed_at IS NULL) первыми, по порядку создания.
CREATE INDEX IF NOT EXISTS outbox_unprocessed_idx
  ON public.outbox (processed_at NULLS FIRST, created_at);

COMMENT ON TABLE public.outbox IS
  'Transactional outbox (раздел 16): бизнес-событие пишется в одной транзакции с операцией; '
  'диспетчер (BullMQ recurring) обрабатывает processed_at IS NULL и проставляет processed_at.';

-- 2. audit_log (PARTITION BY RANGE по месяцам) ------------------------------
CREATE TABLE IF NOT EXISTS public.audit_log (
  id               uuid        NOT NULL DEFAULT gen_random_uuid(),
  actor_user_id    uuid        NULL,
  actor_email_hmac text        NULL,
  event_type       text        NOT NULL,
  target_type      text        NULL,
  target_id        uuid        NULL,
  payload          jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at       timestamptz NOT NULL DEFAULT now()
) PARTITION BY RANGE (created_at);

COMMENT ON TABLE public.audit_log IS
  'Журнал security/admin-событий (раздел 22), партиционирован по месяцам. БЕЗ секретов: '
  'токены/пароли/plain reset-токены/presigned-URL/OCR-фрагменты с ПДн не пишутся (sanitizeAuditFields).';

-- Индексы на РОДИТЕЛЕ распространяются на все партиции (текущие и будущие при attach).
CREATE INDEX IF NOT EXISTS audit_log_actor_created_idx
  ON public.audit_log (actor_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_event_created_idx
  ON public.audit_log (event_type, created_at DESC);

-- Партиции: текущий месяц + 12 будущих. Имя audit_log_YYYY_MM, границы [месяц; следующий месяц).
-- Создаются относительно момента применения (now()), поэтому файл миграции стабилен по checksum.
-- Дальнейшее create-ahead и DROP старых — retention-cron (Iteration 7, AuditPartitionMaintenance).
DO $audit_part$
DECLARE
  base_month date := date_trunc('month', now())::date;
  i          int;
  start_d    date;
  end_d      date;
  pname      text;
BEGIN
  FOR i IN 0..12 LOOP
    start_d := (base_month + (i || ' month')::interval)::date;
    end_d   := (base_month + ((i + 1) || ' month')::interval)::date;
    pname   := format('audit_log_%s', to_char(start_d, 'YYYY_MM'));
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS public.%I PARTITION OF public.audit_log FOR VALUES FROM (%L) TO (%L)',
      pname, start_d, end_d
    );
  END LOOP;
END
$audit_part$;

-- DEFAULT-партиция — страховка от потери записи, если подходящей месячной партиции нет
-- (при create-ahead на 12 месяцев в неё не попадают строки с created_at = now()).
CREATE TABLE IF NOT EXISTS public.audit_log_default PARTITION OF public.audit_log DEFAULT;

-- 3. jobs_log ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.jobs_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  queue_name  text        NOT NULL,
  job_id      text        NOT NULL,
  type        text        NOT NULL,
  status      text        NOT NULL,
  attempts    integer     NOT NULL DEFAULT 0,
  last_error  text        NULL,
  duration_ms integer     NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Алерты dead jobs / retention 'done' → индекс по (status, created_at).
CREATE INDEX IF NOT EXISTS jobs_log_status_created_idx
  ON public.jobs_log (status, created_at DESC);
CREATE INDEX IF NOT EXISTS jobs_log_queue_created_idx
  ON public.jobs_log (queue_name, created_at DESC);

COMMENT ON TABLE public.jobs_log IS
  'Отчётность по BullMQ-задачам (раздел 21): статус done/failed/dead, attempts, duration_ms, last_error.';
