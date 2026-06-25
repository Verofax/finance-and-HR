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
-- entitlement_days = annual 24 (policy)
-- accrued_days = opening + leave_available from Excel (representing what's available to take)
-- taken_days = leave_taken from Excel
-- The remaining_days view will compute: accrued + carry_forward - taken - encashed
-- ============================================================================
do $$
declare
  this_year int := extract(year from current_date)::int;
begin
  -- Format: (code, opening, available_this_year, taken_2026)
  -- The Excel "Leave balance" = opening + available - taken, so we backfill accrued accordingly.
  insert into leave_balances (employee_id, year, leave_type, entitlement_days, accrued_days, taken_days, carry_forward_days)
  select e.id, this_year, 'annual', 24, t.opening + t.available, t.taken, t.opening
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
