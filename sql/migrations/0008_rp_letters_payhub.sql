-- Миграция 0008: интеграция реестра РП с письмами PayHub.
--
-- Контекст: при создании РП BillHub асинхронно (BullMQ-воркер, ретраи с растущим
-- интервалом) создаёт исходящее письмо во внешней системе PayHub. Локальный номер
-- РП («РП-000001») сохраняется как стабильный внутренний идентификатор; рег.номер
-- письма PayHub хранится отдельно и показывается в реестре как основной «Номер».
--
-- Статусы синхронизации (payhub_letter_status):
--   NULL           — письмо не запрашивалось (старые РП);
--   uploading      — РП создана, клиент догружает файлы (finalize ещё не вызван);
--   pending        — задача в очереди / выполняется;
--   waiting_config — ожидание конфигурации (нет сопоставления объекта / отправителя /
--                    интеграция не настроена) — НЕ ошибка, sweep переставляет в очередь;
--   synced         — письмо создано, номер/ссылка записаны;
--   failed         — попытки исчерпаны, ручной повтор кнопкой в реестре.
--
-- payhub_letter_payload — снимок полей формы письма (subject, content,
-- responsiblePersonName): письмо может создаваться позже, когда PayHub станет доступен.
-- rp_letter_attachments — файлы формы письма: лежат в billhub S3, воркер дозагружает их
-- к письму PayHub после его создания (payhub_attachment_id — дедуп при повторе).
--
-- Идемпотентность создания письма — по external_ref = 'billhub:rp:<uuid>' (доработка
-- на стороне PayHub, парная миграция в проекте payhub).
--
-- Без top-level BEGIN/COMMIT — runner оборачивает миграцию в транзакцию (ADR-0002).
-- Идемпотентность — через IF NOT EXISTS.

ALTER TABLE public.rp_letters
  ADD COLUMN IF NOT EXISTS payhub_letter_id                text,
  ADD COLUMN IF NOT EXISTS payhub_letter_reg_number        text,
  ADD COLUMN IF NOT EXISTS payhub_letter_url               text,
  ADD COLUMN IF NOT EXISTS payhub_letter_status            text,
  ADD COLUMN IF NOT EXISTS payhub_letter_error             text,
  ADD COLUMN IF NOT EXISTS payhub_letter_payload           jsonb,
  ADD COLUMN IF NOT EXISTS payhub_letter_status_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS payhub_letter_sync_attempts     integer NOT NULL DEFAULT 0;

-- Для sweep-задачи (выборка pending/waiting_config).
CREATE INDEX IF NOT EXISTS idx_rp_letters_payhub_letter_status
  ON public.rp_letters (payhub_letter_status);

CREATE TABLE IF NOT EXISTS public.rp_letter_attachments (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rp_letter_id         uuid NOT NULL REFERENCES public.rp_letters(id) ON DELETE CASCADE,
  file_key             text NOT NULL,
  file_name            text NOT NULL,
  mime_type            text,
  size_bytes           bigint,
  payhub_attachment_id text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  -- Идемпотентность регистрации: повтор с тем же файлом (потеря ответа) не дублирует строку.
  CONSTRAINT rp_letter_attachments_letter_file_unique UNIQUE (rp_letter_id, file_key)
);

CREATE INDEX IF NOT EXISTS idx_rp_letter_attachments_rp_letter_id
  ON public.rp_letter_attachments (rp_letter_id);
