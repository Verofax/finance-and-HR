// ============================================================================
// Verofax Commission Calculator
// ============================================================================
// Implements the Nov 5, 2025 Sales Commission Policy:
//   - Originator: 1% of Net Revenue Received
//   - Closer:     4% of Net Revenue Received
//   - Sales Head: 2% of Net Revenue Received
//   - CAP:        5% (NOT 7%) when same individual fills ALL THREE roles
//   - Only on amount actually RECEIVED (not invoiced)
//   - No commission on cancelled / refunded / unpaid deals
// ============================================================================

export const ORIGINATOR_PCT = 1;
export const CLOSER_PCT     = 4;
export const SALES_HEAD_PCT = 2;
export const TRIPLE_ROLE_CAP_PCT = 5;

export interface DealInput {
  id: string;
  currency: string;
  amount_received: number;
  third_party_expenses: number;
  marketing_allowance: number;
  deal_originator_id: string | null;
  deal_closer_id: string | null;
  sales_head_id: string | null;
  status: string;
  fx_rate_to_aed: number;
}

export interface PerEmployeeBonus {
  employee_id: string;
  roles: string[];           // ['originator','closer','sales_head'] etc.
  percent_applied: number;   // After cap rule
  base_currency: string;
  base_amount: number;       // Net commissionable (in deal currency)
  bonus_in_currency: number; // base × percent
  fx_rate_to_aed: number;
  bonus_in_aed: number;
  capped: boolean;           // Was the 5% cap triggered?
}

/**
 * Compute the commissionable base (net revenue ACTUALLY received) for a deal.
 *
 * Per policy:
 *   net_received_for_commission = amount_received - (third_party_expenses - marketing_allowance)
 *   …but only the portion of expenses NOT approved as marketing is deducted.
 *   We also scale expenses pro-rata by % received (you only deduct expenses
 *   against the cash you've actually collected).
 */
export function commissionableBase(deal: DealInput): number {
  if (deal.status !== "open") return 0;
  if (deal.amount_received <= 0) return 0;

  // Net deductible expenses (after offsetting marketing allowance)
  const netDeductible = Math.max(
    (deal.third_party_expenses || 0) - (deal.marketing_allowance || 0),
    0,
  );

  // Scale to actual cash received: if 50% paid, only 50% of expenses count
  // against this commission round. (The remaining 50% will be deducted when
  // the rest is paid.)
  const invoiceAmt = deal.amount_received; // assumes received_pct of full invoice
  // Simpler approach: use amount_received directly minus full netDeductible
  // capped at 0. Matches the Excel.
  const base = Math.max(deal.amount_received - netDeductible, 0);
  return base;
}

/**
 * Aggregate roles per employee. Returns a Map of employee_id → roles list.
 */
function rolesByEmployee(deal: DealInput): Map<string, string[]> {
  const m = new Map<string, string[]>();
  function add(id: string | null, role: string) {
    if (!id) return;
    if (!m.has(id)) m.set(id, []);
    m.get(id)!.push(role);
  }
  add(deal.deal_originator_id, "originator");
  add(deal.deal_closer_id, "closer");
  add(deal.sales_head_id, "sales_head");
  return m;
}

const ROLE_PCT: Record<string, number> = {
  originator: ORIGINATOR_PCT,
  closer: CLOSER_PCT,
  sales_head: SALES_HEAD_PCT,
};

/**
 * Compute per-employee bonus for a single deal, applying the policy.
 */
export function bonusForDeal(deal: DealInput): PerEmployeeBonus[] {
  const base = commissionableBase(deal);
  if (base <= 0) return [];

  const map = rolesByEmployee(deal);
  const out: PerEmployeeBonus[] = [];

  for (const [employeeId, roles] of map.entries()) {
    // Sum the percentages for this person's roles
    const rawPct = roles.reduce((sum, r) => sum + (ROLE_PCT[r] || 0), 0);

    // Apply the 5% cap ONLY when same person fills all three roles
    const triple = roles.length === 3
      && roles.includes("originator")
      && roles.includes("closer")
      && roles.includes("sales_head");

    const percent = triple ? TRIPLE_ROLE_CAP_PCT : rawPct;
    const bonusInCurrency = base * (percent / 100);
    const fx = Number(deal.fx_rate_to_aed) || 1;

    out.push({
      employee_id: employeeId,
      roles,
      percent_applied: percent,
      base_currency: deal.currency,
      base_amount: base,
      bonus_in_currency: round2(bonusInCurrency),
      fx_rate_to_aed: fx,
      bonus_in_aed: round2(bonusInCurrency * fx),
      capped: triple,
    });
  }

  return out;
}

/**
 * Aggregate per-staff totals across many deals.
 */
export interface StaffTotal {
  employee_id: string;
  deal_count: number;
  total_in_aed: number;
  per_role: { originator_aed: number; closer_aed: number; sales_head_aed: number; combined_capped_aed: number };
}

export function aggregateByStaff(deals: DealInput[]): Map<string, StaffTotal> {
  const map = new Map<string, StaffTotal>();
  for (const deal of deals) {
    for (const bonus of bonusForDeal(deal)) {
      if (!map.has(bonus.employee_id)) {
        map.set(bonus.employee_id, {
          employee_id: bonus.employee_id,
          deal_count: 0,
          total_in_aed: 0,
          per_role: { originator_aed: 0, closer_aed: 0, sales_head_aed: 0, combined_capped_aed: 0 },
        });
      }
      const s = map.get(bonus.employee_id)!;
      s.deal_count += 1;
      s.total_in_aed += bonus.bonus_in_aed;

      if (bonus.capped) {
        s.per_role.combined_capped_aed += bonus.bonus_in_aed;
      } else {
        // Split the bonus across the roles that contributed
        for (const role of bonus.roles) {
          const rolePct = ROLE_PCT[role] || 0;
          const rolePortion = bonus.base_amount * (rolePct / 100) * bonus.fx_rate_to_aed;
          if (role === "originator") s.per_role.originator_aed += rolePortion;
          if (role === "closer")     s.per_role.closer_aed += rolePortion;
          if (role === "sales_head") s.per_role.sales_head_aed += rolePortion;
        }
      }
    }
  }

  // Round everything to 2dp at the end
  for (const s of map.values()) {
    s.total_in_aed = round2(s.total_in_aed);
    s.per_role.originator_aed = round2(s.per_role.originator_aed);
    s.per_role.closer_aed = round2(s.per_role.closer_aed);
    s.per_role.sales_head_aed = round2(s.per_role.sales_head_aed);
    s.per_role.combined_capped_aed = round2(s.per_role.combined_capped_aed);
  }
  return map;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function formatMoney(n: number, currency = "AED"): string {
  return new Intl.NumberFormat("en", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(n);
}
