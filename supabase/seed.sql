-- ============================================================================
-- Verofax Finance Platform — Seed Data (Dummy Employees + Records)
-- ============================================================================
-- Run AFTER schema.sql. This loads dummy data so you can test the dashboard
-- and the employee profile pages immediately. NONE of this is real Verofax
-- data — names, salaries, IBANs are all fabricated.
--
-- Safe to re-run: uses ON CONFLICT to upsert by employee_code.
-- ============================================================================

-- 8 fake employees across 4 countries, mixed currencies
insert into employees (employee_code, full_name, email, phone, department, designation, country, location, joining_date, status, salary_currency, basic_salary, allowances, basic_salary_aed, fx_rate_to_aed, bank_name, iban, annual_leave_days, air_ticket_entitlement, air_ticket_currency, notes)
values
  ('VFX-001', 'Alex Demo',     'alex@example.test',   '+971500000001', 'Engineering',    'Senior Engineer',     'UAE',        'Dubai',    '2024-03-15', 'active',   'AED', 22000, 3000, 25000, 1.000000, 'Demo Bank UAE',   'AE070331234567890123456', 30, 8000,  'AED', 'Dummy data for demo'),
  ('VFX-002', 'Sam Sample',    'sam@example.test',    '+971500000002', 'Operations',     'Operations Lead',     'UAE',        'Abu Dhabi','2023-08-01', 'active',   'AED', 18000, 2500, 20500, 1.000000, 'Demo Bank UAE',   'AE070331234567890123457', 30, 6000,  'AED', null),
  ('VFX-003', 'Riley Test',    'riley@example.test',  '+966500000003', 'Sales',          'KSA Country Manager', 'KSA',        'Riyadh',   '2025-01-10', 'active',   'SAR', 25000, 4000, 28387, 0.978800, 'Demo Bank KSA',   'SA0380000000608010167519', 30, 5000,  'SAR', null),
  ('VFX-004', 'Jordan Mock',   'jordan@example.test', '+201000000004', 'Engineering',    'Backend Developer',   'Egypt',      'Cairo',    '2024-06-22', 'active',   'EGP', 60000, 8000, 4500,  0.075000, 'Demo Bank EG',    'EG380019000500000000263180002', 21, 1500, 'USD', null),
  ('VFX-005', 'Casey Filler',  'casey@example.test',  '+918000000005', 'Engineering',    'Frontend Developer',  'India',      'Bangalore','2025-04-01', 'active',   'INR', 180000, 25000, 7920, 0.044000, 'Demo Bank IN',    'IN70HDFC0000001234567890', 24, 1500, 'USD', null),
  ('VFX-006', 'Robin Example', 'robin@example.test',  '+442000000006', 'Marketing',      'Marketing Director',  'UK',         'London',   '2023-11-05', 'active',   'GBP', 5500,  1000, 25025, 4.550000, 'Demo Bank UK',    'GB29NWBK60161331926819',  28, 4000, 'GBP', null),
  ('VFX-007', 'Morgan Demo',   'morgan@example.test', '+971500000007', 'HR',             'HR Manager',          'UAE',        'Dubai',    '2024-09-12', 'active',   'AED', 16000, 2000, 18000, 1.000000, 'Demo Bank UAE',   'AE070331234567890123458', 30, 5000,  'AED', null),
  ('VFX-008', 'Pat Placeholder','pat@example.test',   '+260000000008', 'Sales',          'Africa Lead',         'Zambia',     'Lusaka',   '2025-02-18', 'on_leave', 'USD', 4500,  500,  16515, 3.670000, 'Demo Bank ZM',    'ZM0000000000000000000000',  30, 2000,  'USD', 'On extended leave')
on conflict (employee_code) do update set
  full_name = excluded.full_name,
  department = excluded.department,
  designation = excluded.designation,
  basic_salary = excluded.basic_salary,
  allowances = excluded.allowances,
  basic_salary_aed = excluded.basic_salary_aed,
  fx_rate_to_aed = excluded.fx_rate_to_aed;

-- ============================================================================
-- This month's salary records (one per active employee)
-- ============================================================================
do $$
declare
  emp record;
  this_year int := extract(year from current_date);
  this_month int := extract(month from current_date);
begin
  for emp in select id, basic_salary, allowances, salary_currency from employees where status = 'active' loop
    insert into salary_records (
      employee_id, period_year, period_month, currency, basic, allowances,
      status, paid_amount
    ) values (
      emp.id, this_year, this_month, emp.salary_currency,
      emp.basic_salary, emp.allowances,
      -- 60% paid, 40% pending — gives the dashboard something to show
      case when random() < 0.6 then 'paid' else 'pending' end,
      case when random() < 0.6 then emp.basic_salary + emp.allowances else 0 end
    ) on conflict (employee_id, period_year, period_month) do nothing;
  end loop;

  -- Last month's salary records — all paid
  for emp in select id, basic_salary, allowances, salary_currency from employees where status = 'active' loop
    insert into salary_records (
      employee_id, period_year, period_month, currency, basic, allowances,
      status, paid_amount, payment_date, payment_reference
    ) values (
      emp.id,
      case when this_month = 1 then this_year - 1 else this_year end,
      case when this_month = 1 then 12 else this_month - 1 end,
      emp.salary_currency, emp.basic_salary, emp.allowances,
      'paid', emp.basic_salary + emp.allowances,
      (current_date - interval '20 days')::date,
      'PAY-' || floor(random() * 100000)::text
    ) on conflict (employee_id, period_year, period_month) do nothing;
  end loop;
end $$;

-- ============================================================================
-- Leave balances (current year, all active employees)
-- ============================================================================
insert into leave_balances (employee_id, year, entitlement_days, accrued_days, taken_days)
select
  id,
  extract(year from current_date)::int,
  annual_leave_days,
  annual_leave_days * 0.5,  -- mid-year accrual
  floor(random() * 12)::numeric
from employees where status = 'active'
on conflict (employee_id, year) do nothing;

-- ============================================================================
-- A few benefits / credits
-- ============================================================================
insert into benefits_credits (employee_id, type, description, amount, currency, status)
select id, 'bonus', 'Q1 performance bonus', 5000, salary_currency, 'pending'
from employees where employee_code in ('VFX-001', 'VFX-003', 'VFX-006')
on conflict do nothing;

insert into benefits_credits (employee_id, type, description, amount, currency, status, due_date)
select id, 'air_ticket', 'Annual home leave ticket', air_ticket_entitlement, air_ticket_currency, 'approved', current_date + interval '60 days'
from employees where status = 'active' and air_ticket_entitlement > 0
on conflict do nothing;

insert into benefits_credits (employee_id, type, description, amount, currency, status)
select id, 'advance', 'Salary advance — to be recovered next month', 2000, salary_currency, 'pending'
from employees where employee_code = 'VFX-004'
on conflict do nothing;
