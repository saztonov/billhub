-- ============================================================================
-- BillHub: создание всех таблиц
-- Запускать в Supabase Dashboard -> SQL Editor
-- ============================================================================

-- Таблица пользователей (связана с auth.users)
create table if not exists users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  role text not null default 'viewer' check (role in ('admin', 'manager', 'viewer')),
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- Справочники
-- ----------------------------------------------------------------------------

-- Контрагенты (поставщики)
create table if not exists counterparties (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  inn text not null default '',
  kpp text not null default '',
  address text not null default '',
  contact_person text not null default '',
  phone text not null default '',
  email text not null default '',
  created_at timestamptz not null default now()
);

-- Сотрудники
create table if not exists employees (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  position text not null default '',
  department text not null default '',
  email text not null default '',
  phone text not null default '',
  role text not null default 'viewer' check (role in ('admin', 'manager', 'viewer')),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Объекты строительства
create table if not exists construction_sites (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text not null default '',
  description text not null default '',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Типы документов
create table if not exists document_types (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text not null default '',
  is_required boolean not null default false,
  created_at timestamptz not null default now()
);

-- Маппинг обязательных документов объекта (many-to-many)
create table if not exists site_required_documents_mapping (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references construction_sites(id) on delete cascade,
  document_type_id uuid not null references document_types(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (site_id, document_type_id)
);

-- ----------------------------------------------------------------------------
-- Документооборот
-- ----------------------------------------------------------------------------

-- Счета
create table if not exists invoices (
  id uuid primary key default gen_random_uuid(),
  counterparty_id uuid not null references counterparties(id) on delete cascade,
  number text not null default '',
  date date,
  total_amount numeric(15, 2) not null default 0,
  status text not null default 'new' check (status in ('new', 'recognized', 'processed', 'error')),
  file_url text not null default '',
  file_name text not null default '',
  ocr_result text,
  created_at timestamptz not null default now()
);

-- Спецификации (строки счёта)
create table if not exists specifications (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references invoices(id) on delete cascade,
  position integer not null default 1,
  name text not null default '',
  unit text not null default '',
  quantity numeric(15, 4) not null default 0,
  price numeric(15, 2) not null default 0,
  amount numeric(15, 2) not null default 0,
  created_at timestamptz not null default now()
);

-- Документы (прикреплённые файлы контрагента/поставки)
create table if not exists documents (
  id uuid primary key default gen_random_uuid(),
  counterparty_id uuid not null references counterparties(id) on delete cascade,
  document_type_id uuid not null references document_types(id) on delete restrict,
  site_id uuid not null references construction_sites(id) on delete restrict,
  file_name text not null default '',
  file_url text not null default '',
  uploaded_at timestamptz not null default now()
);

-- Распределительные письма (РП)
create table if not exists distribution_letters (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references invoices(id) on delete cascade,
  counterparty_id uuid not null references counterparties(id) on delete cascade,
  site_id uuid not null references construction_sites(id) on delete restrict,
  number text not null default '',
  date date,
  total_amount numeric(15, 2) not null default 0,
  status text not null default 'draft' check (status in ('draft', 'pending', 'approved', 'rejected', 'ordered')),
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- Согласования
-- ----------------------------------------------------------------------------

-- Цепочки согласований (конструктор)
create table if not exists approval_chains (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text not null default '',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Этапы (шаги) цепочки
create table if not exists approval_steps (
  id uuid primary key default gen_random_uuid(),
  chain_id uuid not null references approval_chains(id) on delete cascade,
  step_order integer not null default 1,
  employee_id uuid not null references employees(id) on delete restrict,
  role text not null default '',
  is_required boolean not null default true,
  unique (chain_id, step_order)
);

-- Факты согласования
create table if not exists approvals (
  id uuid primary key default gen_random_uuid(),
  distribution_letter_id uuid not null references distribution_letters(id) on delete cascade,
  step_id uuid not null references approval_steps(id) on delete restrict,
  employee_id uuid not null references employees(id) on delete restrict,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  comment text not null default '',
  decided_at timestamptz,
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- Настройки
-- ----------------------------------------------------------------------------

-- Модели OCR (OpenRouter)
create table if not exists ocr_models (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  model_id text not null,
  is_active boolean not null default false,
  created_at timestamptz not null default now()
);
