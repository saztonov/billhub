-- Миграция 0007: сопоставление объектов строительства с сущностями PayHub.
--
-- Контекст: в справочнике «Объекты строительства» для каждого объекта задаётся «синоним»
-- из PayHub — проект (catalog/projects) и заказчик/контрагент (catalog/contractors).
-- Храним канонический внешний ID + снимок для отображения (code/name/inn), чтобы роль
-- user видела значения без обращения к PayHub, а отображение не терялось при временной
-- недоступности/переименовании во внешней системе.
--
-- Типы ID: PayHubProject.id — number (integer, нужен как project_id для писем);
-- PayHubContractor.id — number|string (храним text для устойчивости).
-- FK и UNIQUE не добавляем: PayHub — внешняя система, один проект пока допустимо
-- назначить нескольким объектам.
--
-- Без top-level BEGIN/COMMIT — runner оборачивает миграцию в транзакцию (ADR-0002).
-- Идемпотентность — через IF NOT EXISTS.

ALTER TABLE public.construction_sites
  ADD COLUMN IF NOT EXISTS payhub_project_id       integer,
  ADD COLUMN IF NOT EXISTS payhub_project_code     text,
  ADD COLUMN IF NOT EXISTS payhub_project_name     text,
  ADD COLUMN IF NOT EXISTS payhub_contractor_id    text,
  ADD COLUMN IF NOT EXISTS payhub_contractor_name  text,
  ADD COLUMN IF NOT EXISTS payhub_contractor_inn   text;
