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
