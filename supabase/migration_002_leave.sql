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
