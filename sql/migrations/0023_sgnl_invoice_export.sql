-- Миграция 0023: выгрузка счетов заявок на оплату в SIGNAL DOCS (docs.sgnl.pro).
--
-- Контекст: счета из заявок на оплату раз в сутки выгружаются в SIGNAL DOCS по пути
-- <Проект>[/<подпапка>]/12. Снабжение/Счета/<Поставщик>. Первичная выгрузка — первый
-- прогон той же задачи с пустым журналом.
--
--   * construction_sites.sgnl_project_id / sgnl_project_name / sgnl_base_path — сопоставление
--     объекта BillHub с проектом SIGNAL (по образцу payhub_project_* из 0007): канонический
--     внешний ID + снимок названия для отображения + необязательная подпапка проекта, внутри
--     которой лежит «12. Снабжение» (проект «Дом 56 + реновация» разделён на две подпапки).
--     FK и UNIQUE нет: SIGNAL — внешняя система.
--   * sgnl_file_exports — журнал выгрузки: одна строка на файл счёта. Хранит промежуточные
--     id объекта/версии SIGNAL, чтобы после сбоя на середине цепочки загрузки продолжить
--     без дубля, и итоговый item SIGNAL. При удалении файла/заявки в BillHub история
--     сохраняется (FK ON DELETE SET NULL).
--   * Текущее сопоставление объектов заполняется здесь же (только незаполненные поля).
--     В окружениях без этих объектов UPDATE ничего не меняет.
--
-- Без top-level BEGIN/COMMIT — runner оборачивает миграцию в транзакцию (ADR-0002).
-- Аддитивная и идемпотентная (IF NOT EXISTS, UPDATE ... WHERE sgnl_project_id IS NULL).

-- ============================================================
-- 1. Сопоставление объекта строительства с проектом SIGNAL
-- ============================================================
ALTER TABLE public.construction_sites
  ADD COLUMN IF NOT EXISTS sgnl_project_id   uuid,
  ADD COLUMN IF NOT EXISTS sgnl_project_name text,
  ADD COLUMN IF NOT EXISTS sgnl_base_path    text;

-- ============================================================
-- 2. Журнал выгрузки файлов в SIGNAL
-- ============================================================
CREATE TABLE IF NOT EXISTS public.sgnl_file_exports (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_request_file_id  uuid UNIQUE
                             REFERENCES public.payment_request_files (id) ON DELETE SET NULL,
  payment_request_id       uuid REFERENCES public.payment_requests (id) ON DELETE SET NULL,
  site_id                  uuid REFERENCES public.construction_sites (id) ON DELETE SET NULL,
  supplier_id              uuid REFERENCES public.suppliers (id) ON DELETE SET NULL,
  sgnl_project_id          uuid NOT NULL,
  sgnl_folder_id           uuid,
  sgnl_object_id           uuid,
  sgnl_version_id          uuid,
  sgnl_item_id             uuid,
  target_path              text NOT NULL,
  target_name              text NOT NULL,
  status                   text NOT NULL DEFAULT 'pending'
                             CHECK (status IN ('pending', 'done', 'failed', 'skipped')),
  attempts                 integer NOT NULL DEFAULT 0,
  last_error               text,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  exported_at              timestamptz
);

CREATE INDEX IF NOT EXISTS idx_sgnl_file_exports_status
  ON public.sgnl_file_exports (status);

-- Повторное использование папки поставщика из прошлых прогонов
CREATE INDEX IF NOT EXISTS idx_sgnl_file_exports_project_supplier
  ON public.sgnl_file_exports (sgnl_project_id, supplier_id) WHERE status = 'done';

-- ============================================================
-- 3. Текущее сопоставление объектов BillHub → проекты SIGNAL
-- ============================================================
UPDATE public.construction_sites AS cs
SET sgnl_project_id   = m.project_id::uuid,
    sgnl_project_name = m.project_name,
    sgnl_base_path    = m.base_path
FROM (VALUES
  ('e8d0f217-50bc-4c5b-83e8-2909154b8b92', '019c1e8d-93fa-751b-98a7-0ae44774ad78', 'ЖК "Алия"', NULL),
  ('80919c4b-7a2f-48cb-b6f8-b6ef401a2aff', '019c1e8e-6e02-7aff-9189-e2a329228fbd', 'ЖК "Зиларт, лот 33"', NULL),
  ('db6fe5b3-77c5-4b7c-82e6-328fb3b292b2', '019d007b-e505-73d8-b2b1-69f6ec841589', 'ЖК "Injoy"', NULL),
  ('8f8d7a73-e22d-46c0-a1c3-5be3bbfa2883', '019d007b-92b0-794e-a077-5a2cbb9d5eb5', 'ЖК "Дом 56 + реновация"', 'Дом 56'),
  ('d22263ac-8056-4d44-a9ea-69246ad46df0', '019c2896-6cd7-75a6-92d9-909e9234731f', 'ЖК "King&sons"', NULL),
  ('97d0bab6-d0ef-40d2-bc63-d329670b3fa6', '019d007c-294d-7d1a-a701-2d100da5166c', 'ЖК "Садовническая 69"', NULL),
  ('dcb3de80-b812-4580-bd72-5e827a9dffba', '019d007b-52d3-7583-81f0-03dfb0f0673e', 'ЖК "WAVE-2"', NULL),
  ('29630a4f-a844-435a-980a-0b5c6806d536', '01a07b6d-ea35-7e40-8761-560b7e1922c9', 'ЖК "Wave-1"', NULL),
  ('9e7e8af5-29b2-4785-bd31-e1f15e0c2543', '019d007c-de37-7ef5-87d9-ae7b369f4377', 'ЖК "Stories"', NULL),
  ('6d569360-bdb4-4be6-852b-84950b644af0', '019d007c-057b-7f95-a3a9-c405e569464b', 'ЖК "Primavera, 14"', NULL),
  ('cbf95387-a58f-4282-94dd-37ea05c73a94', '019d1b1f-1360-7415-a900-ea90482967de', 'ЖК "Primavera, 13"', NULL),
  ('6395a422-7c0e-49b4-870a-5c2d595d6cc9', '019ffa3d-b23e-7405-bf44-2a5457cd8f89', 'ЖК "Событие 6.1"', NULL),
  ('2a16dcf2-5661-476d-a3d0-df1050cc7ce3', '019d007c-4ae5-7c56-863d-ef816a79cbf3', 'ЖК "Событие 6.2"', NULL),
  ('0b9da0fc-12cf-4a3d-a942-2fe2d4be45e6', '019d007c-8e87-70b0-a7eb-537281972866', 'ЖК "Зил 18,19,27"', NULL)
) AS m (site_id, project_id, project_name, base_path)
WHERE cs.id = m.site_id::uuid
  AND cs.sgnl_project_id IS NULL;
