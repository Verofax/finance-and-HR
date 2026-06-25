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
