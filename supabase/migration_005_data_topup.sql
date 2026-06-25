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
