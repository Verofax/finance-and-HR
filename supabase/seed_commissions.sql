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
