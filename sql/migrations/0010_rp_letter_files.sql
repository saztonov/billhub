-- Миграция 0010: тип файла вложения письма РП + служебные файлы РП.
--
-- Контекст:
--   1) file_type у вложений письма (rp_letter_attachments):
--        'rp'    — скан чистовика письма с печатью; дублируется в поле «РП»
--                  связанных заявок (payment_requests.dp_file_key);
--        'other' — прочие вложения письма.
--      Частичный уникальный индекс гарантирует не более одного файла типа 'rp' на письмо
--      (защита от гонок/повторов регистрации помимо валидации в коде).
--   2) rp_letter_service_files — служебные файлы РП: лежат в billhub S3, в PayHub НЕ
--      уходят, управляются из реестра (кнопка «Файлы»: загрузка/просмотр/скачивание/удаление).
--
-- Без top-level BEGIN/COMMIT — runner оборачивает миграцию в транзакцию (ADR-0002).
-- Идемпотентность — через IF NOT EXISTS (inline CHECK добавляется вместе с колонкой,
-- повторный ADD COLUMN IF NOT EXISTS его не дублирует).

ALTER TABLE public.rp_letter_attachments
  ADD COLUMN IF NOT EXISTS file_type text NOT NULL DEFAULT 'other'
    CHECK (file_type IN ('rp', 'other'));

-- Не более одного файла типа 'rp' на письмо.
CREATE UNIQUE INDEX IF NOT EXISTS uq_rp_letter_attachments_one_rp
  ON public.rp_letter_attachments (rp_letter_id)
  WHERE file_type = 'rp';

CREATE TABLE IF NOT EXISTS public.rp_letter_service_files (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rp_letter_id uuid NOT NULL REFERENCES public.rp_letters(id) ON DELETE CASCADE,
  file_key     text NOT NULL,
  file_name    text NOT NULL,
  mime_type    text,
  size_bytes   bigint,
  created_by   uuid NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rp_letter_service_files_rp_letter_id
  ON public.rp_letter_service_files (rp_letter_id);
