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
