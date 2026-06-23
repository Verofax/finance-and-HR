-- ============================================================================
-- Verofax Finance Management Platform — Phase 1 Schema
-- ============================================================================
-- Run this in a brand-new Supabase project (DO NOT run on the growth-os
-- Supabase). Use the SQL Editor in your Supabase dashboard.
--
-- This schema:
--   1. Sets up the finance_users allowlist (only people in this table can log in)
--   2. Creates employees + payroll/leave/benefits tables (Phase 2+ uses these)
--   3. Locks every table down with RLS — even authenticated users cannot read
--      financial data unless they're in finance_users AND have the right role
--   4. Adds an audit_logs trigger so every salary/employee mutation is recorded
--
-- After running this, manually insert your finance team in finance_users.
-- ============================================================================

-- ============================================================================
-- 1. FINANCE USERS — the allowlist (gates ALL access)
-- ============================================================================
create table if not exists finance_users (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  full_name text not null,
  role text not null check (role in ('admin', 'finance', 'hr', 'viewer')),
  active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_finance_users_email on finance_users(email);

-- ============================================================================
-- 2. EMPLOYEES — the people we pay
-- ============================================================================
create table if not exists employees (
  id uuid primary key default gen_random_uuid(),
  employee_code text unique not null,
  full_name text not null,
  email text,
  phone text,
  department text,
  designation text,
  country text,
  location text,
  joining_date date,
  status text default 'active' check (status in ('active', 'inactive', 'on_leave', 'terminated')),

  -- Compensation
  salary_currency text not null default 'AED',
  basic_salary numeric(14, 2) default 0,
  allowances numeric(14, 2) default 0,
  -- Stored equivalent in AED for cross-currency reporting (recomputed on currency change)
  basic_salary_aed numeric(14, 2) default 0,
  fx_rate_to_aed numeric(10, 6) default 1,

  -- Bank
  bank_name text,
  bank_account text,
  iban text,
  swift text,

  -- Entitlements
  annual_leave_days numeric(5, 1) default 30,
  air_ticket_entitlement numeric(14, 2) default 0,
  air_ticket_currency text default 'AED',

  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  created_by uuid references finance_users(id),
  updated_by uuid references finance_users(id)
);

create index if not exists idx_employees_status on employees(status);
create index if not exists idx_employees_department on employees(department);
create index if not exists idx_employees_country on employees(country);

-- ============================================================================
-- 3. SALARY RECORDS — monthly payroll log (Phase 2 will populate)
-- ============================================================================
create table if not exists salary_records (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id) on delete cascade,
  period_year int not null,
  period_month int not null check (period_month between 1 and 12),

  currency text not null default 'AED',
  basic numeric(14, 2) default 0,
  allowances numeric(14, 2) default 0,
  bonus numeric(14, 2) default 0,
  commission numeric(14, 2) default 0,
  reimbursement numeric(14, 2) default 0,
  deductions numeric(14, 2) default 0,
  advance_recovery numeric(14, 2) default 0,
  unpaid_leave_deduction numeric(14, 2) default 0,
  net_payable numeric(14, 2) generated always as (
    coalesce(basic,0) + coalesce(allowances,0) + coalesce(bonus,0) + coalesce(commission,0)
    + coalesce(reimbursement,0) - coalesce(deductions,0) - coalesce(advance_recovery,0)
    - coalesce(unpaid_leave_deduction,0)
  ) stored,

  status text default 'pending' check (status in ('pending', 'paid', 'partial', 'cancelled')),
  paid_amount numeric(14, 2) default 0,
  payment_date date,
  payment_reference text,

  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  created_by uuid references finance_users(id),
  updated_by uuid references finance_users(id),

  unique (employee_id, period_year, period_month)
);

create index if not exists idx_salary_records_employee on salary_records(employee_id);
create index if not exists idx_salary_records_period on salary_records(period_year, period_month);
create index if not exists idx_salary_records_status on salary_records(status);

-- ============================================================================
-- 4. LEAVE BALANCES — yearly leave ledger
-- ============================================================================
create table if not exists leave_balances (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id) on delete cascade,
  year int not null,
  entitlement_days numeric(5, 1) default 30,
  accrued_days numeric(5, 1) default 0,
  taken_days numeric(5, 1) default 0,
  unpaid_days numeric(5, 1) default 0,
  remaining_days numeric(5, 1) generated always as (
    coalesce(accrued_days,0) - coalesce(taken_days,0)
  ) stored,
  notes text,
  updated_at timestamptz default now(),
  updated_by uuid references finance_users(id),
  unique (employee_id, year)
);

create index if not exists idx_leave_balances_employee on leave_balances(employee_id);

-- ============================================================================
-- 5. BENEFITS & CREDITS — air ticket, bonus, expense claim, reimbursement, etc.
-- ============================================================================
create table if not exists benefits_credits (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id) on delete cascade,
  type text not null check (type in ('air_ticket', 'bonus', 'commission', 'reimbursement', 'expense_claim', 'advance', 'other')),
  description text,
  amount numeric(14, 2) not null,
  currency text not null default 'AED',
  status text default 'pending' check (status in ('pending', 'approved', 'paid', 'rejected')),
  due_date date,
  paid_date date,
  attachment_url text,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  created_by uuid references finance_users(id)
);

create index if not exists idx_benefits_employee on benefits_credits(employee_id);
create index if not exists idx_benefits_type on benefits_credits(type);
create index if not exists idx_benefits_status on benefits_credits(status);

-- ============================================================================
-- 6. SALES BONUS / COMMISSION — target vs achieved tracker
-- ============================================================================
create table if not exists sales_bonus (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id) on delete cascade,
  period_year int not null,
  period_quarter int check (period_quarter between 1 and 4),
  period_month int check (period_month between 1 and 12),
  target_amount numeric(14, 2) default 0,
  achieved_amount numeric(14, 2) default 0,
  commission_percent numeric(5, 2),
  fixed_bonus numeric(14, 2),
  bonus_due numeric(14, 2) default 0,
  bonus_paid numeric(14, 2) default 0,
  currency text not null default 'AED',
  status text default 'pending' check (status in ('pending', 'approved', 'paid', 'cancelled')),
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  created_by uuid references finance_users(id)
);

create index if not exists idx_sales_bonus_employee on sales_bonus(employee_id);
create index if not exists idx_sales_bonus_period on sales_bonus(period_year, period_quarter, period_month);

-- ============================================================================
-- 7. AUDIT LOGS — every mutation on salary/employee/leave/bonus is recorded
-- ============================================================================
create table if not exists audit_logs (
  id uuid primary key default gen_random_uuid(),
  user_email text not null,
  user_role text,
  action text not null,            -- 'insert' | 'update' | 'delete'
  entity_type text not null,       -- 'employee' | 'salary_record' | etc
  entity_id uuid,
  before_data jsonb,
  after_data jsonb,
  ip_address text,
  user_agent text,
  created_at timestamptz default now()
);

create index if not exists idx_audit_logs_entity on audit_logs(entity_type, entity_id);
create index if not exists idx_audit_logs_user on audit_logs(user_email);
create index if not exists idx_audit_logs_created on audit_logs(created_at desc);

-- ============================================================================
-- 8. RLS POLICIES — finance_users gates everything
-- ============================================================================
alter table finance_users enable row level security;
alter table employees enable row level security;
alter table salary_records enable row level security;
alter table leave_balances enable row level security;
alter table benefits_credits enable row level security;
alter table sales_bonus enable row level security;
alter table audit_logs enable row level security;

-- Helper: is the current auth user a finance_users record?
create or replace function is_finance_user() returns boolean
language sql security definer stable as $$
  select exists (
    select 1 from finance_users
    where email = (select auth.jwt() ->> 'email')
    and active = true
  );
$$;

create or replace function finance_role() returns text
language sql security definer stable as $$
  select role from finance_users
  where email = (select auth.jwt() ->> 'email')
  and active = true
  limit 1;
$$;

-- finance_users: only admins can read/write the user list
drop policy if exists "admin manages users" on finance_users;
create policy "admin manages users" on finance_users
  for all using (finance_role() = 'admin') with check (finance_role() = 'admin');

-- Authenticated finance users can read their own row (for the layout greeting)
drop policy if exists "self read" on finance_users;
create policy "self read" on finance_users
  for select using (email = (select auth.jwt() ->> 'email'));

-- employees: admin + hr full access; finance + viewer read only
drop policy if exists "employees read" on employees;
create policy "employees read" on employees
  for select using (is_finance_user());

drop policy if exists "employees write" on employees;
create policy "employees write" on employees
  for all using (finance_role() in ('admin', 'hr'))
  with check (finance_role() in ('admin', 'hr'));

-- salary_records: admin + finance only
drop policy if exists "salary read" on salary_records;
create policy "salary read" on salary_records
  for select using (finance_role() in ('admin', 'finance', 'viewer'));

drop policy if exists "salary write" on salary_records;
create policy "salary write" on salary_records
  for all using (finance_role() in ('admin', 'finance'))
  with check (finance_role() in ('admin', 'finance'));

-- leave_balances: admin + hr; finance read; viewer read
drop policy if exists "leave read" on leave_balances;
create policy "leave read" on leave_balances
  for select using (is_finance_user());

drop policy if exists "leave write" on leave_balances;
create policy "leave write" on leave_balances
  for all using (finance_role() in ('admin', 'hr'))
  with check (finance_role() in ('admin', 'hr'));

-- benefits_credits: admin + finance + hr
drop policy if exists "benefits read" on benefits_credits;
create policy "benefits read" on benefits_credits
  for select using (is_finance_user());

drop policy if exists "benefits write" on benefits_credits;
create policy "benefits write" on benefits_credits
  for all using (finance_role() in ('admin', 'finance', 'hr'))
  with check (finance_role() in ('admin', 'finance', 'hr'));

-- sales_bonus: admin + finance
drop policy if exists "bonus read" on sales_bonus;
create policy "bonus read" on sales_bonus
  for select using (is_finance_user());

drop policy if exists "bonus write" on sales_bonus;
create policy "bonus write" on sales_bonus
  for all using (finance_role() in ('admin', 'finance'))
  with check (finance_role() in ('admin', 'finance'));

-- audit_logs: admin read; everyone can insert via trigger
drop policy if exists "audit admin read" on audit_logs;
create policy "audit admin read" on audit_logs
  for select using (finance_role() = 'admin');

drop policy if exists "audit insert" on audit_logs;
create policy "audit insert" on audit_logs
  for insert with check (is_finance_user());

-- ============================================================================
-- 9. AUDIT TRIGGERS
-- ============================================================================
create or replace function log_audit() returns trigger
language plpgsql security definer as $$
declare
  user_email text := (select auth.jwt() ->> 'email');
  user_role text := finance_role();
begin
  insert into audit_logs (user_email, user_role, action, entity_type, entity_id, before_data, after_data)
  values (
    coalesce(user_email, 'system'),
    user_role,
    lower(tg_op),
    tg_table_name,
    coalesce(new.id, old.id),
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end
  );
  return coalesce(new, old);
end; $$;

drop trigger if exists audit_employees on employees;
create trigger audit_employees after insert or update or delete on employees
  for each row execute function log_audit();

drop trigger if exists audit_salary on salary_records;
create trigger audit_salary after insert or update or delete on salary_records
  for each row execute function log_audit();

drop trigger if exists audit_leave on leave_balances;
create trigger audit_leave after insert or update or delete on leave_balances
  for each row execute function log_audit();

drop trigger if exists audit_benefits on benefits_credits;
create trigger audit_benefits after insert or update or delete on benefits_credits
  for each row execute function log_audit();

drop trigger if exists audit_bonus on sales_bonus;
create trigger audit_bonus after insert or update or delete on sales_bonus
  for each row execute function log_audit();

-- ============================================================================
-- 10. BOOTSTRAP — break-glass admin (CHANGE EMAIL BELOW)
-- ============================================================================
-- After running this schema, sign up via the app (or in Supabase Auth dashboard)
-- with verofax1@gmail.com, then this row makes you an admin.
insert into finance_users (email, full_name, role, active)
values ('verofax1@gmail.com', 'Super Admin', 'admin', true)
on conflict (email) do update set role = 'admin', active = true;

-- ============================================================================
-- Done. Next: run seed.sql for dummy demo data.
-- ============================================================================
