-- ============================================================================
-- VEROFAX FINANCE PLATFORM — RUN-ALL MIGRATION
-- ============================================================================
-- This file contains ALL migrations + seeds in correct dependency order.
-- Run ONCE in Supabase SQL Editor. Idempotent — safe to re-run.
--
-- ORDER:
--   1. migration_002_leave.sql        (manager_email, leave types, requests)
--   2. migration_003_commission.sql   (fx_rates, deals, payments)
--   3. migration_004_currency.sql     (AED/SAR/USD constraint, QAR, Zain→SAR, Hassan)
--   4. seed_staff.sql                 (18 real Verofax staff + balances from Excel)
--   5. seed_commissions.sql           (11 commission deals from Excel)
--   6. migration_005_data_topup.sql   (Mohammed Zain rename + Kaust investment)
--   7. migration_006_leave_history.sql (balance fix + 3 new staff + Jan-Jun 2026 leaves)
-- ============================================================================



-- ############################################################################
-- # FILE: supabase/migration_002_leave.sql
-- ############################################################################

-- ============================================================================
-- Migration 002 — Leave Management
-- ============================================================================
-- Adds:
--   1. manager_email column on employees (who approves their leave)
--   2. leave_type + encashed_days + carry_forward on leave_balances (per-type ledger)
--   3. leave_requests table — public submissions, tokenized manager approval
--   4. RLS + audit trigger for leave_requests
--   5. Helper: current_year_balance(employee_id, leave_type) view
-- ============================================================================

-- 1. manager_email on employees
alter table employees add column if not exists manager_email text;
update employees set manager_email = 'wassim@verofax.com' where manager_email is null;
create index if not exists idx_employees_manager_email on employees(manager_email);

-- 2. Refactor leave_balances to support multiple leave types per employee per year
-- (existing rows assumed to be 'annual'; if you already ran seed.sql with annual-only data, it's preserved)
alter table leave_balances add column if not exists leave_type text default 'annual';
alter table leave_balances add column if not exists encashed_days numeric(5, 1) default 0;
alter table leave_balances add column if not exists carry_forward_days numeric(5, 1) default 0;

-- Backfill existing rows
update leave_balances set leave_type = 'annual' where leave_type is null;
alter table leave_balances alter column leave_type set not null;

-- Drop + re-add constraint (idempotent — safe to re-run)
alter table leave_balances drop constraint if exists leave_type_valid;
alter table leave_balances add constraint leave_type_valid check (
  leave_type in ('annual', 'sick', 'maternity', 'paternity', 'mourning', 'haj', 'unpaid', 'other')
);

-- Drop the old unique constraint (year+employee) and recreate including leave_type
do $$
begin
  if exists (select 1 from pg_constraint where conname = 'leave_balances_employee_id_year_key') then
    alter table leave_balances drop constraint leave_balances_employee_id_year_key;
  end if;
end $$;
alter table leave_balances drop constraint if exists leave_balances_emp_year_type_uniq;
alter table leave_balances add constraint leave_balances_emp_year_type_uniq unique (employee_id, year, leave_type);

-- 3. leave_requests — public submissions
create table if not exists leave_requests (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id) on delete cascade,
  leave_type text not null check (leave_type in ('annual', 'sick', 'maternity', 'paternity', 'mourning', 'haj', 'unpaid', 'other')),
  start_date date not null,
  end_date date not null,
  days_count numeric(5, 1) not null,
  reason text,

  -- Approval flow
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  manager_email text not null,
  -- Single-use signed token for manager's approve/reject email link
  approval_token uuid not null default gen_random_uuid(),
  token_used_at timestamptz,
  decided_by_email text,
  decided_at timestamptz,
  decision_notes text,

  -- Bookkeeping
  submitted_via text default 'public_form',  -- 'public_form' | 'admin'
  submitter_ip text,
  submitter_user_agent text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_leave_requests_employee on leave_requests(employee_id);
create index if not exists idx_leave_requests_status on leave_requests(status);
create index if not exists idx_leave_requests_token on leave_requests(approval_token);
create index if not exists idx_leave_requests_manager on leave_requests(manager_email);

-- 4. RLS for leave_requests
alter table leave_requests enable row level security;

-- Admin + HR + finance can read all requests
drop policy if exists "leave_req read" on leave_requests;
create policy "leave_req read" on leave_requests
  for select using (is_finance_user());

-- Admin + HR can write (admin overrides, manual approvals)
drop policy if exists "leave_req write" on leave_requests;
create policy "leave_req write" on leave_requests
  for all using (finance_role() in ('admin', 'hr'))
  with check (finance_role() in ('admin', 'hr'));

-- NOTE: public submissions and token-approval-page use service_role via server actions —
-- they bypass RLS by design. The submission API validates input itself.

-- Audit trigger
drop trigger if exists audit_leave_req on leave_requests;
create trigger audit_leave_req after insert or update or delete on leave_requests
  for each row execute function log_audit();

-- 5. Helper view: current-year balance per employee per leave-type
create or replace view current_leave_balances as
select
  e.id as employee_id,
  e.full_name,
  e.employee_code,
  e.department,
  e.country,
  e.manager_email,
  lb.year,
  lb.leave_type,
  coalesce(lb.entitlement_days, 0) as entitlement_days,
  coalesce(lb.accrued_days, 0) as accrued_days,
  coalesce(lb.taken_days, 0) as taken_days,
  coalesce(lb.encashed_days, 0) as encashed_days,
  coalesce(lb.carry_forward_days, 0) as carry_forward_days,
  (coalesce(lb.accrued_days, 0) + coalesce(lb.carry_forward_days, 0)
    - coalesce(lb.taken_days, 0) - coalesce(lb.encashed_days, 0)) as remaining_days
from employees e
left join leave_balances lb on lb.employee_id = e.id and lb.year = extract(year from current_date)::int
where e.status in ('active', 'on_leave');

-- 6. RPC to deduct from balance on approval (called by server action)
create or replace function deduct_leave_balance(
  p_employee_id uuid,
  p_leave_type text,
  p_year int,
  p_days numeric
) returns void
language plpgsql security definer as $$
begin
  insert into leave_balances (employee_id, year, leave_type, entitlement_days, accrued_days, taken_days)
  values (p_employee_id, p_year, p_leave_type,
          case when p_leave_type = 'annual' then 24 when p_leave_type = 'sick' then 10 else 0 end,
          case when p_leave_type = 'annual' then 24 when p_leave_type = 'sick' then 10 else 0 end,
          p_days)
  on conflict (employee_id, year, leave_type)
  do update set
    taken_days = leave_balances.taken_days + p_days,
    updated_at = now();
end; $$;


-- ############################################################################
-- # FILE: supabase/migration_003_commission.sql
-- ############################################################################

-- ============================================================================
-- Migration 003 — Sales Commission / Bonus
-- ============================================================================
-- Implements the Nov 2025 Verofax Commission Policy:
--   - Originator 1% + Closer 4% + Sales Head 2% on Net Revenue Received
--   - 5% cap when same person fills all three roles
--   - Multi-currency with AED equivalent
--   - Commission paid only on amount actually received
-- ============================================================================

-- 1. FX rates (manually maintained for monthly book-keeping)
create table if not exists fx_rates (
  currency text primary key,
  rate_to_aed numeric(12, 6) not null,
  updated_at timestamptz default now(),
  updated_by uuid references finance_users(id)
);

insert into fx_rates (currency, rate_to_aed) values
  ('AED', 1.000000),
  ('SAR', 0.979330),
  ('USD', 3.672500),
  ('EUR', 4.020000),
  ('GBP', 4.650000),
  ('EGP', 0.075000),
  ('INR', 0.044000)
on conflict (currency) do nothing;

-- 2. commission_deals — one row per invoice/deal
create table if not exists commission_deals (
  id uuid primary key default gen_random_uuid(),
  year int not null,
  client_name text not null,
  invoice_number text,
  currency text not null default 'AED',

  -- Money (all in deal currency)
  invoice_amount_ex_vat numeric(14, 2) default 0,    -- Gross excl. tax
  third_party_expenses numeric(14, 2) default 0,     -- Holobox, accessories, etc.
  marketing_allowance numeric(14, 2) default 0,      -- Approved as marketing cost (NOT deducted)
  amount_received numeric(14, 2) default 0,          -- What client has actually paid

  -- Net commissionable = invoice - (expenses - marketing_allowance)
  net_amount numeric(14, 2) generated always as (
    greatest(coalesce(invoice_amount_ex_vat, 0)
             - greatest(coalesce(third_party_expenses, 0) - coalesce(marketing_allowance, 0), 0), 0)
  ) stored,

  -- Balance still to receive
  balance_to_receive numeric(14, 2) generated always as (
    greatest(coalesce(invoice_amount_ex_vat, 0) - coalesce(amount_received, 0), 0)
  ) stored,

  -- Received % (for display)
  received_percent numeric(5, 2) generated always as (
    case when coalesce(invoice_amount_ex_vat, 0) > 0
         then round(100.0 * coalesce(amount_received, 0) / invoice_amount_ex_vat, 2)
         else 0 end
  ) stored,

  -- The three roles
  deal_originator_id uuid references employees(id),
  deal_closer_id uuid references employees(id),
  sales_head_id uuid references employees(id),

  -- Lifecycle
  status text default 'open' check (status in ('open', 'cancelled', 'refunded', 'archived')),
  payment_receipt_date date,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  created_by uuid references finance_users(id),
  updated_by uuid references finance_users(id)
);

create index if not exists idx_deals_year on commission_deals(year);
create index if not exists idx_deals_status on commission_deals(status);
create index if not exists idx_deals_originator on commission_deals(deal_originator_id);
create index if not exists idx_deals_closer on commission_deals(deal_closer_id);
create index if not exists idx_deals_head on commission_deals(sales_head_id);

-- 3. commission_payments — log of bonus payouts to staff (for tracking)
create table if not exists commission_payments (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id),
  deal_id uuid not null references commission_deals(id) on delete cascade,
  role text not null check (role in ('originator', 'closer', 'sales_head', 'combined_cap')),
  percent_applied numeric(5, 2) not null,
  base_currency text not null,
  base_amount numeric(14, 2) not null,
  bonus_in_currency numeric(14, 2) not null,
  fx_rate_to_aed numeric(12, 6) not null default 1,
  bonus_in_aed numeric(14, 2) not null,
  status text default 'pending' check (status in ('pending', 'approved', 'paid', 'cancelled')),
  paid_date date,
  payment_reference text,
  notes text,
  created_at timestamptz default now(),
  created_by uuid references finance_users(id)
);

create index if not exists idx_payouts_employee on commission_payments(employee_id);
create index if not exists idx_payouts_deal on commission_payments(deal_id);
create index if not exists idx_payouts_status on commission_payments(status);

-- 4. RLS
alter table fx_rates enable row level security;
alter table commission_deals enable row level security;
alter table commission_payments enable row level security;

-- fx_rates: anyone in finance_users can read; admin/finance can write
drop policy if exists "fx read" on fx_rates;
create policy "fx read" on fx_rates for select using (is_finance_user());
drop policy if exists "fx write" on fx_rates;
create policy "fx write" on fx_rates
  for all using (finance_role() in ('admin', 'finance'))
  with check (finance_role() in ('admin', 'finance'));

-- commission_deals: admin/finance only
drop policy if exists "deals read" on commission_deals;
create policy "deals read" on commission_deals
  for select using (finance_role() in ('admin', 'finance', 'viewer'));
drop policy if exists "deals write" on commission_deals;
create policy "deals write" on commission_deals
  for all using (finance_role() in ('admin', 'finance'))
  with check (finance_role() in ('admin', 'finance'));

-- commission_payments: admin/finance only
drop policy if exists "payouts read" on commission_payments;
create policy "payouts read" on commission_payments
  for select using (finance_role() in ('admin', 'finance', 'viewer'));
drop policy if exists "payouts write" on commission_payments;
create policy "payouts write" on commission_payments
  for all using (finance_role() in ('admin', 'finance'))
  with check (finance_role() in ('admin', 'finance'));

-- 5. Audit triggers
drop trigger if exists audit_deals on commission_deals;
create trigger audit_deals after insert or update or delete on commission_deals
  for each row execute function log_audit();

drop trigger if exists audit_payouts on commission_payments;
create trigger audit_payouts after insert or update or delete on commission_payments
  for each row execute function log_audit();


-- ############################################################################
-- # FILE: supabase/migration_004_currency.sql
-- ############################################################################

-- ============================================================================
-- Migration 004 — Currency rules per 2026-06-25 update
-- ============================================================================
-- Rules:
--   1. Invoices are issued in AED / SAR / USD only
--   2. Commission is earned in the invoice currency
--   3. Payment to sales team is converted to each staff's REGION currency
--      (UAE → AED, KSA → SAR, Qatar → QAR, etc) — uses employees.salary_currency
--   4. Add QAR to fx_rates (Qatari Riyal, pegged near AED)
-- ============================================================================

-- 1. Restrict deal currency to AED / SAR / USD
alter table commission_deals drop constraint if exists deal_currency_valid;
alter table commission_deals add constraint deal_currency_valid
  check (currency in ('AED', 'SAR', 'USD'));

-- Migrate any existing rows that have other currencies (should be none in seed)
update commission_deals set currency = 'AED' where currency not in ('AED', 'SAR', 'USD');

-- 2. Add QAR to FX rates (Qatari Riyal)
insert into fx_rates (currency, rate_to_aed) values ('QAR', 1.008750)
on conflict (currency) do nothing;

-- 3. Update Zain's payment currency to SAR (Saudi-based sales)
update employees
set salary_currency = 'SAR'
where employee_code = 'VFX-019';

-- 4. Add Hassan (Qatar) — appears in May 2026 leave Excel, salary currency QAR
insert into employees (
  employee_code, full_name, country, status,
  salary_currency, annual_leave_days, manager_email
) values
  ('VFX-020', 'Hassan', 'Qatar', 'active', 'QAR', 24, 'wassim@verofax.com')
on conflict (employee_code) do update set
  salary_currency = 'QAR',
  country = 'Qatar';

-- Make sure he has 2026 leave balances too
do $$
declare
  hassan_id uuid := (select id from employees where employee_code = 'VFX-020');
  yr int := extract(year from current_date)::int;
begin
  if hassan_id is not null then
    insert into leave_balances (employee_id, year, leave_type, entitlement_days, accrued_days, taken_days)
    values (hassan_id, yr, 'annual', 24, 12, 0),
           (hassan_id, yr, 'sick', 10, 10, 0)
    on conflict (employee_id, year, leave_type) do nothing;
  end if;
end $$;


-- ############################################################################
-- # FILE: supabase/seed_staff.sql
-- ############################################################################

-- ============================================================================
-- REAL Verofax staff seed (from leave Excel as of Jun 2026)
-- Run AFTER schema.sql + migration_002_leave.sql.
-- Default manager_email = wassim@verofax.com for everyone (update later).
-- Salaries left at 0 (managed on the other platform per Neha).
-- ============================================================================

-- 18 staff with current annual + sick balances from the Excel
insert into employees (
  employee_code, full_name, email, country, joining_date, status,
  salary_currency, annual_leave_days, manager_email, notes
) values
  ('VFX-001', 'Wassim Merheby',    null, 'UAE',    null, 'active', 'AED', 24, 'wassim@verofax.com',         null),
  ('VFX-002', 'Majd Alchoum',      null, 'UAE',    null, 'active', 'AED', 24, 'wassim@verofax.com',         null),
  ('VFX-003', 'Priya',             null, 'India',  null, 'active', 'AED', 24, 'hiren@verofax.com',          null),
  ('VFX-004', 'Mohana Priya',      null, 'India',  null, 'active', 'AED', 24, 'hiren@verofax.com',          null),
  ('VFX-005', 'Shaima Gawankar',   null, 'UAE',    null, 'active', 'AED', 24, 'hiren@verofax.com',          null),
  ('VFX-006', 'Neha Sharma',       'verofax1@gmail.com', 'UAE', null, 'active', 'AED', 24, 'wassim@verofax.com', null),
  ('VFX-007', 'Archana Thyagaraj', null, 'India',  null, 'active', 'AED', 24, 'hiren@verofax.com',          null),
  ('VFX-008', 'Louay Alshoum',     null, 'KSA',    null, 'active', 'AED', 24, 'hiren@verofax.com',          'Last working day 17/3/2026'),
  ('VFX-009', 'Ridhima Sharma',    null, 'India',  null, 'active', 'AED', 24, 'wassim@verofax.com',         null),
  ('VFX-010', 'Nisreen Shadad',    null, 'UAE',    null, 'active', 'AED', 24, 'wassim@verofax.com',         null),
  ('VFX-011', 'Sandra Azzi',       null, 'Lebanon',null, 'active', 'AED', 24, 'wassim@verofax.com',         null),
  ('VFX-012', 'Jennifer Moawad',   null, 'Lebanon',null, 'active', 'AED', 24, 'wassim@verofax.com',         null),
  ('VFX-013', 'Hiren',             null, 'India',  null, 'active', 'AED', 24, 'wassim@verofax.com',         null),
  ('VFX-014', 'Juby',              null, 'India',  null, 'active', 'AED', 24, 'saleem.lalani@verofax.com',  null),
  ('VFX-015', 'Yahia',             null, 'UAE',    null, 'active', 'AED', 24, 'hiren@verofax.com',          null),
  ('VFX-016', 'Saleem',            null, 'UAE',    null, 'active', 'AED', 24, 'wassim@verofax.com',         null),
  ('VFX-017', 'Sharad',            null, 'India',  null, 'active', 'AED', 24, 'hiren@verofax.com',          'Last working day 31/3/2026'),
  ('VFX-018', 'Fakhri',            null, 'UAE',    null, 'active', 'AED', 24, 'wassim@verofax.com',         null)
on conflict (employee_code) do update set
  full_name = excluded.full_name,
  country = excluded.country,
  manager_email = excluded.manager_email,
  notes = excluded.notes;

-- ============================================================================
-- ANNUAL leave balances (from Excel)
-- Policy: 24 days/year entitlement; carry-forward from previous years allowed.
-- accrued_days  = YTD-accrued this year (Excel "Leave available")
-- carry_forward = brought in from previous years (Excel "Opening Leave")
-- taken_days    = taken so far this year (Excel "Leave taken 2026")
-- remaining (computed by view) = accrued + carry_forward - taken - encashed
-- ============================================================================
do $$
declare
  this_year int := extract(year from current_date)::int;
begin
  -- Format: (code, opening, available_this_year, taken_2026)
  insert into leave_balances (employee_id, year, leave_type, entitlement_days, accrued_days, taken_days, carry_forward_days)
  select e.id, this_year, 'annual', 24, t.available, t.taken, t.opening
  from employees e
  join (values
    ('VFX-001', 48::numeric, 12::numeric, 0::numeric),
    ('VFX-002', 23, 12, 0),
    ('VFX-003', 18, 12, 0),
    ('VFX-004', 12.5, 12, 7),
    ('VFX-005', 29.5, 12, 7),
    ('VFX-006', 46, 12, 0),
    ('VFX-007', 27.5, 5, 11),
    ('VFX-008', 14, 12, 1),
    ('VFX-009', 45, 12, 20),
    ('VFX-010', 33, 12, 4),
    ('VFX-011', 38, 12, 0),
    ('VFX-012', 42, 12, 0),
    ('VFX-013', 41, 12, 1),
    ('VFX-014', 13.5, 12, 1),
    ('VFX-015', 12, 12, 8),
    ('VFX-016', 9, 12, 0),
    ('VFX-017', 13, 12, 2),
    ('VFX-018', 0, 12, 0)
  ) as t(code, opening, available, taken) on t.code = e.employee_code
  on conflict (employee_id, year, leave_type) do update set
    entitlement_days = excluded.entitlement_days,
    accrued_days = excluded.accrued_days,
    taken_days = excluded.taken_days,
    carry_forward_days = excluded.carry_forward_days;

  -- SICK leave balances (10 days entitlement)
  insert into leave_balances (employee_id, year, leave_type, entitlement_days, accrued_days, taken_days)
  select e.id, this_year, 'sick', 10, 10, t.taken
  from employees e
  join (values
    ('VFX-001', 0::numeric),
    ('VFX-002', 1),
    ('VFX-003', 3),
    ('VFX-004', 1),
    ('VFX-005', 6),
    ('VFX-006', 1),
    ('VFX-007', 3),
    ('VFX-008', 2),
    ('VFX-009', 4),
    ('VFX-010', 0),
    ('VFX-011', 0),
    ('VFX-012', 4),
    ('VFX-013', 0),
    ('VFX-014', 0),
    ('VFX-015', 4),
    ('VFX-016', 1),
    ('VFX-017', 0),
    ('VFX-018', 1)
  ) as t(code, taken) on t.code = e.employee_code
  on conflict (employee_id, year, leave_type) do update set
    entitlement_days = excluded.entitlement_days,
    accrued_days = excluded.accrued_days,
    taken_days = excluded.taken_days;
end $$;


-- ############################################################################
-- # FILE: supabase/seed_commissions.sql
-- ############################################################################

-- ============================================================================
-- Seed: 11 commission deals from the current Excel + missing sales staff.
-- Run AFTER migration_003_commission.sql + seed_staff.sql.
-- ============================================================================

-- Add sales-only staff not in the leave Excel (Zain)
insert into employees (employee_code, full_name, country, status, salary_currency, manager_email)
values ('VFX-019', 'Zain', 'KSA', 'active', 'AED', 'wassim@verofax.com')
on conflict (employee_code) do nothing;

-- Insert deals (idempotent via unique invoice_number)
-- Excel values used directly. Roles wired by employee_code lookup.
do $$
declare
  w uuid := (select id from employees where full_name = 'Wassim Merheby' limit 1);
  m uuid := (select id from employees where full_name = 'Majd Alchoum' limit 1);
  n uuid := (select id from employees where full_name = 'Nisreen Shadad' limit 1);
  z uuid := (select id from employees where full_name = 'Zain' limit 1);
begin
  -- Idempotent: clear any prior seed rows for the same client+year+invoice we're about to add
  delete from commission_deals where notes = 'seed:initial';

  insert into commission_deals (
    year, client_name, invoice_number, currency,
    invoice_amount_ex_vat, third_party_expenses, marketing_allowance, amount_received,
    deal_originator_id, deal_closer_id, sales_head_id, status, notes
  ) values
    -- 1. Al Othaim Project 1 — SAR, 50% received
    (2025, 'Al Othaim Project 1', null, 'SAR', 26848, 6432, 6432, 13424, w, m, m, 'open', 'seed:initial'),
    -- 2. Smartcode (NWC) — SAR, 40% received, Zain on all 3 roles
    (2025, 'Smartcode (NWC)', null, 'SAR', 204347, 20623, 20623, 81739, z, z, z, 'open', 'seed:initial'),
    -- 3. Thiqah — SAR, 100% received
    (2025, 'Thiqah', null, 'SAR', 15000, 0, 0, 15000, w, n, m, 'open', 'seed:initial'),
    -- 4. FluidAI Medical — SAR, 100% received, Majd all 3 roles
    (2025, 'FluidAI Medical', null, 'SAR', 27750, 1700, 0, 27750, m, m, m, 'open', 'seed:initial'),
    -- 5. DU for Gitex — AED, 100% received
    (2025, 'DU for Gitex', null, 'AED', 182043, 35180, 0, 182043, m, n, m, 'open', 'seed:initial'),
    -- 6. DCT — AED, 100% received
    (2025, 'DCT', null, 'AED', 497198, 31422, 0, 497198, m, m, m, 'open', 'seed:initial'),
    -- 7. Aldhafrah (2024) — AED, 100% received
    (2024, 'Aldhafrah', null, 'AED', 10000, 0, 0, 10000, w, n, n, 'open', 'seed:initial'),
    -- 8. Emirates Redcrescent Mini Holobox — AED, 100% received, Majd all 3
    (2025, 'Emirates Redcrescent — Mini Holobox', null, 'AED', 25000, 3357, 0, 25000, m, m, m, 'open', 'seed:initial'),
    -- 9. EKFC invoice 1 — USD, 100% received, Majd all 3
    (2026, 'EKFC', 'EKFC-01', 'USD', 63570, 0, 0, 63570, m, m, m, 'open', 'seed:initial'),
    -- 10. EKFC invoice 2 — USD, 100% received, Majd all 3
    (2026, 'EKFC', 'EKFC-02', 'USD', 63570, 0, 0, 63570, m, m, m, 'open', 'seed:initial'),
    -- 11. Nawahil (2024) — historical, no roles assigned (orphan in Excel)
    (2024, 'Nawahil', null, 'SAR', 31800, 0, 0, 31800, null, null, null, 'archived', 'seed:initial');
end $$;


-- ############################################################################
-- # FILE: supabase/migration_005_data_topup.sql
-- ############################################################################

-- ============================================================================
-- Migration 005 — Top-up data per 2026-06-25 Excel
-- ============================================================================
-- 1. Rename "Zain" to "Mohammed Zain" (his full name, per Neha's reference)
-- 2. Add Kaust investment deal (USD 250,000 — appears in Majd's per-person
--    panel as the "investment" line that drove his total to 97,724 AED)
-- 3. Confirm all 11 sales deals from the Excel are present
-- ============================================================================

-- 1. Full name update
update employees
set full_name = 'Mohammed Zain'
where employee_code = 'VFX-019' and full_name = 'Zain';

-- 2. Kaust investment deal
-- Per Majd's panel: USD 250,000, 5% applied (5% cap because all 3 roles = Majd)
-- → 12,500 USD = 45,906 AED commission
do $$
declare
  majd uuid := (select id from employees where full_name = 'Majd Alchoum' limit 1);
begin
  if majd is null then
    raise notice 'Majd not found — skipping Kaust seed';
    return;
  end if;

  -- Idempotent — replace any previous Kaust seed
  delete from commission_deals where client_name = 'Kaust' and notes like 'seed:%';

  insert into commission_deals (
    year, client_name, invoice_number, currency,
    invoice_amount_ex_vat, third_party_expenses, marketing_allowance, amount_received,
    deal_originator_id, deal_closer_id, sales_head_id,
    status, notes
  ) values (
    2025, 'Kaust', null, 'USD',
    250000, 0, 0, 250000,
    majd, majd, majd,
    'open', 'seed:initial · Investment deal — flagged separately in Majd panel'
  );
end $$;

-- 3. Quick sanity print (in psql / SQL Editor you'll see the row count)
-- select count(*) as deal_count, sum(amount_received) as total_received_mixed_currency
-- from commission_deals where notes like 'seed:%';


-- ############################################################################
-- # FILE: supabase/migration_006_leave_history.sql
-- ############################################################################

-- ============================================================================
-- Migration 006 — Leave history Jan-Jun 2026 + balance fix + new staff
-- ============================================================================
-- 1. FIX a double-count bug in the seed:
--    accrued_days was set to (opening + available), AND carry_forward was set
--    to opening. The current_leave_balances view then computed
--    accrued + carry_forward = double-count. Fix by setting accrued back to
--    just the YTD value.
-- 2. Add 3 staff who appear only in 2026 monthly data:
--    Khushboo (India), Sandrine Haddad (Lebanon), Kishan (India)
-- 3. Import Jan-Jun 2026 leave records as approved leave_requests so the
--    history is queryable per month, per employee.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Balance fix — subtract carry_forward from accrued_days where double-counted
-- ----------------------------------------------------------------------------
update leave_balances
set accrued_days = greatest(accrued_days - carry_forward_days, 0),
    updated_at = now()
where leave_type = 'annual'
  and carry_forward_days > 0
  and accrued_days > carry_forward_days;  -- only fix if double-counted

-- ----------------------------------------------------------------------------
-- 2. New staff from monthly Jan-Jun data
-- ----------------------------------------------------------------------------
insert into employees (employee_code, full_name, country, status, salary_currency, annual_leave_days, manager_email)
values
  ('VFX-021', 'Khushboo',         'India',   'active', 'AED', 24, 'hiren@verofax.com'),
  ('VFX-022', 'Sandrine Haddad',  'Lebanon', 'active', 'AED', 24, 'wassim@verofax.com'),
  ('VFX-023', 'Kishan',           'India',   'active', 'AED', 24, 'hiren@verofax.com')
on conflict (employee_code) do update set
  full_name = excluded.full_name,
  country = excluded.country,
  manager_email = excluded.manager_email;

-- Seed leave balances for new staff (current year)
do $$
declare
  yr int := extract(year from current_date)::int;
begin
  insert into leave_balances (employee_id, year, leave_type, entitlement_days, accrued_days, taken_days, carry_forward_days)
  select id, yr, 'annual', 24, 12, 0, 0 from employees where employee_code in ('VFX-021', 'VFX-022', 'VFX-023')
  on conflict (employee_id, year, leave_type) do nothing;

  insert into leave_balances (employee_id, year, leave_type, entitlement_days, accrued_days, taken_days)
  select id, yr, 'sick', 10, 10, 0 from employees where employee_code in ('VFX-021', 'VFX-022', 'VFX-023')
  on conflict (employee_id, year, leave_type) do nothing;
end $$;

-- ----------------------------------------------------------------------------
-- 3. Temporary helper function for inserting historical leave records.
--    Dropped at the end so it doesn't pollute the schema.
-- ----------------------------------------------------------------------------
create or replace function _import_leave(
  p_code text, p_type text, p_start date, p_end date, p_days numeric, p_reason text default null
) returns void language plpgsql as $$
declare
  e_id uuid;
  e_mgr text;
begin
  select id, manager_email into e_id, e_mgr from employees where employee_code = p_code;
  if e_id is null then
    raise notice 'Employee not found: %', p_code;
    return;
  end if;
  insert into leave_requests (
    employee_id, leave_type, start_date, end_date, days_count, reason,
    status, manager_email,
    decided_by_email, decided_at, decision_notes,
    submitted_via
  ) values (
    e_id, p_type, p_start, p_end, p_days, p_reason,
    'approved', e_mgr,
    'historical_import@verofax.com', '2026-06-25 09:00:00+00', 'historical:2026-jun-import',
    'admin'
  );
end $$;

-- Idempotent: clear any previous historical-import rows before inserting fresh
delete from leave_requests where decision_notes = 'historical:2026-jun-import';

-- ============= JANUARY 2026 =============
select _import_leave('VFX-004', 'annual', '2026-01-02', '2026-01-02', 1);   -- Mohana Priya
select _import_leave('VFX-007', 'annual', '2026-01-26', '2026-01-26', 1);   -- Archana
select _import_leave('VFX-010', 'annual', '2026-01-27', '2026-01-30', 4);   -- Nisreen 27-30
select _import_leave('VFX-003', 'sick',   '2026-01-16', '2026-01-16', 1);   -- Priya
select _import_leave('VFX-015', 'sick',   '2026-01-22', '2026-01-22', 1);   -- Yahia
select _import_leave('VFX-016', 'sick',   '2026-01-08', '2026-01-08', 1);   -- Saleem

-- ============= FEBRUARY 2026 =============
select _import_leave('VFX-007', 'annual', '2026-02-02', '2026-02-04', 3);   -- Archana 2,3,4
select _import_leave('VFX-007', 'sick',   '2026-02-26', '2026-02-26', 1);   -- Archana
select _import_leave('VFX-008', 'annual', '2026-02-25', '2026-02-25', 1);   -- Louay
select _import_leave('VFX-008', 'sick',   '2026-02-06', '2026-02-06', 1);   -- Louay
select _import_leave('VFX-009', 'annual', '2026-02-16', '2026-02-27', 10);  -- Ridhima 16-27 (10 working)
select _import_leave('VFX-014', 'annual', '2026-02-12', '2026-02-12', 1);   -- Juby
select _import_leave('VFX-015', 'annual', '2026-02-09', '2026-02-13', 5);   -- Yahia 9-13
select _import_leave('VFX-015', 'annual', '2026-02-16', '2026-02-16', 1);   -- Yahia + 16
select _import_leave('VFX-003', 'sick',   '2026-02-03', '2026-02-03', 1);   -- Priya
select _import_leave('VFX-003', 'sick',   '2026-02-13', '2026-02-13', 1);   -- Priya
select _import_leave('VFX-005', 'sick',   '2026-02-23', '2026-02-23', 1);   -- Shaima
select _import_leave('VFX-012', 'sick',   '2026-02-17', '2026-02-17', 1);   -- Jennifer
select _import_leave('VFX-012', 'sick',   '2026-02-19', '2026-02-19', 1);   -- Jennifer
select _import_leave('VFX-016', 'sick',   '2026-02-10', '2026-02-10', 1);   -- Saleem

-- ============= MARCH 2026 =============
select _import_leave('VFX-005', 'annual', '2026-03-05', '2026-03-05', 1);   -- Shaima
select _import_leave('VFX-005', 'annual', '2026-03-24', '2026-03-24', 1);   -- Shaima
select _import_leave('VFX-005', 'annual', '2026-03-27', '2026-03-27', 1);   -- Shaima
select _import_leave('VFX-007', 'annual', '2026-03-25', '2026-03-27', 3);   -- Archana 25-27
select _import_leave('VFX-007', 'annual', '2026-03-30', '2026-03-31', 2);   -- Archana 30,31
select _import_leave('VFX-008', 'sick',   '2026-03-16', '2026-03-16', 1);   -- Louay
select _import_leave('VFX-017', 'annual', '2026-03-09', '2026-03-10', 2);   -- Sharad
select _import_leave('VFX-015', 'annual', '2026-03-26', '2026-03-26', 1);   -- Yahia
select _import_leave('VFX-015', 'sick',   '2026-03-04', '2026-03-04', 1);   -- Yahia
select _import_leave('VFX-003', 'maternity', '2026-03-09', '2026-06-15', 65); -- Priya 65 business days

-- ============= APRIL 2026 =============
select _import_leave('VFX-004', 'annual', '2026-04-15', '2026-04-15', 1);   -- Mohana
select _import_leave('VFX-005', 'annual', '2026-04-06', '2026-04-07', 2);   -- Shaima
select _import_leave('VFX-005', 'sick',   '2026-04-03', '2026-04-03', 1);   -- Shaima
select _import_leave('VFX-005', 'sick',   '2026-04-22', '2026-04-22', 1);   -- Shaima
select _import_leave('VFX-007', 'annual', '2026-04-01', '2026-04-02', 2);   -- Archana
select _import_leave('VFX-007', 'sick',   '2026-04-27', '2026-04-27', 1);   -- Archana
select _import_leave('VFX-013', 'annual', '2026-04-28', '2026-04-28', 1);   -- Hiren
select _import_leave('VFX-014', 'other',  '2026-04-02', '2026-04-03', 2, 'Religious leave'); -- Juby
select _import_leave('VFX-015', 'sick',   '2026-04-14', '2026-04-14', 1);   -- Yahia
select _import_leave('VFX-015', 'sick',   '2026-04-29', '2026-04-29', 1);   -- Yahia
select _import_leave('VFX-009', 'sick',   '2026-04-06', '2026-04-07', 2);   -- Ridhima
select _import_leave('VFX-020', 'sick',   '2026-04-13', '2026-04-13', 1);   -- Hassan
select _import_leave('VFX-023', 'annual', '2026-04-28', '2026-04-30', 3);   -- Kishan

-- ============= MAY 2026 =============
select _import_leave('VFX-004', 'annual', '2026-05-25', '2026-05-29', 5);   -- Mohana
select _import_leave('VFX-004', 'sick',   '2026-05-18', '2026-05-18', 1);   -- Mohana
select _import_leave('VFX-005', 'annual', '2026-05-14', '2026-05-14', 1);   -- Shaima
select _import_leave('VFX-005', 'sick',   '2026-05-04', '2026-05-04', 1);   -- Shaima
select _import_leave('VFX-005', 'sick',   '2026-05-19', '2026-05-20', 2);   -- Shaima
select _import_leave('VFX-009', 'annual', '2026-05-04', '2026-05-15', 10);  -- Ridhima 4-15 (10 working)
select _import_leave('VFX-009', 'sick',   '2026-05-18', '2026-05-19', 2);   -- Ridhima
select _import_leave('VFX-012', 'sick',   '2026-05-01', '2026-05-01', 1);   -- Jennifer
select _import_leave('VFX-012', 'sick',   '2026-05-21', '2026-05-21', 1);   -- Jennifer
select _import_leave('VFX-021', 'annual', '2026-05-08', '2026-05-08', 1);   -- Khushboo
select _import_leave('VFX-022', 'sick',   '2026-05-14', '2026-05-14', 1);   -- Sandrine Haddad
select _import_leave('VFX-020', 'mourning','2026-05-30', '2026-05-30', 1, 'Mourning leave'); -- Hassan
select _import_leave('VFX-002', 'sick',   '2026-05-18', '2026-05-18', 1);   -- Majd

-- ============= JUNE 2026 =============
select _import_leave('VFX-005', 'annual', '2026-06-04', '2026-06-04', 1);   -- Shaima
select _import_leave('VFX-015', 'annual', '2026-06-17', '2026-06-17', 1);   -- Yahia
select _import_leave('VFX-006', 'sick',   '2026-06-01', '2026-06-01', 1);   -- Neha
select _import_leave('VFX-007', 'sick',   '2026-06-08', '2026-06-08', 1);   -- Archana
select _import_leave('VFX-021', 'annual', '2026-06-01', '2026-06-01', 1);   -- Khushboo
select _import_leave('VFX-020', 'sick',   '2026-06-08', '2026-06-08', 1);   -- Hassan

-- Clean up temporary function
drop function if exists _import_leave(text, text, date, date, numeric, text);
