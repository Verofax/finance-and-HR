// ============================================================================
// Verofax Commission Calculator
// ============================================================================
// Policy (Nov 5, 2025) + Currency rules (Jun 25, 2026):
//   - Invoices issued in AED / SAR / USD only
//   - Originator 1% + Closer 4% + Sales Head 2% on Net Revenue Received
//   - 5% CAP when same individual fills ALL THREE roles
//   - Commission IS EARNED in the invoice currency (deal currency)
//   - Commission IS PAID in each staff's REGION currency (employees.salary_currency)
//   - Conversion: invoice_currency → AED → staff_payment_currency (via fx_rates)
// ============================================================================

export const ORIGINATOR_PCT = 1;
export const CLOSER_PCT     = 4;
export const SALES_HEAD_PCT = 2;
export const TRIPLE_ROLE_CAP_PCT = 5;
export const ALLOWED_INVOICE_CURRENCIES = ["AED", "SAR", "USD"] as const;

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
}

export interface PerEmployeeBonus {
  employee_id: string;
  deal_id: string;
  roles: string[];                   // ['originator','closer','sales_head'] etc.
  percent_applied: number;           // After cap rule
  invoice_currency: string;          // Deal currency (AED/SAR/USD)
  base_amount: number;               // Net commissionable in deal currency
  bonus_in_invoice_currency: number; // What they earned, in invoice currency
  capped: boolean;                   // Was the 5% cap triggered?
}

const ROLE_PCT: Record<string, number> = {
  originator: ORIGINATOR_PCT,
  closer: CLOSER_PCT,
  sales_head: SALES_HEAD_PCT,
};

/**
 * Compute the commissionable base (net revenue actually received) for a deal,
 * in the deal's own currency.
 */
export function commissionableBase(deal: DealInput): number {
  if (deal.status !== "open") return 0;
  if (deal.amount_received <= 0) return 0;
  const netDeductible = Math.max(
    (deal.third_party_expenses || 0) - (deal.marketing_allowance || 0),
    0,
  );
  return Math.max(deal.amount_received - netDeductible, 0);
}

function rolesByEmployee(deal: DealInput): Map<string, string[]> {
  const m = new Map<string, string[]>();
  const add = (id: string | null, role: string) => {
    if (!id) return;
    if (!m.has(id)) m.set(id, []);
    m.get(id)!.push(role);
  };
  add(deal.deal_originator_id, "originator");
  add(deal.deal_closer_id, "closer");
  add(deal.sales_head_id, "sales_head");
  return m;
}

/**
 * Compute per-employee commission for a single deal, in the INVOICE currency.
 * Conversion to staff's payment currency is done separately (see convertBonusToPayout).
 */
export function bonusForDeal(deal: DealInput): PerEmployeeBonus[] {
  const base = commissionableBase(deal);
  if (base <= 0) return [];

  const map = rolesByEmployee(deal);
  const out: PerEmployeeBonus[] = [];

  for (const [employeeId, roles] of map.entries()) {
    const rawPct = roles.reduce((sum, r) => sum + (ROLE_PCT[r] || 0), 0);
    const triple = roles.length === 3
      && roles.includes("originator")
      && roles.includes("closer")
      && roles.includes("sales_head");
    const percent = triple ? TRIPLE_ROLE_CAP_PCT : rawPct;
    const bonusInInvoiceCurrency = base * (percent / 100);

    out.push({
      employee_id: employeeId,
      deal_id: deal.id,
      roles,
      percent_applied: percent,
      invoice_currency: deal.currency,
      base_amount: base,
      bonus_in_invoice_currency: round2(bonusInInvoiceCurrency),
      capped: triple,
    });
  }
  return out;
}

// ============================================================================
// FX conversion
// ============================================================================

export type FxMap = Map<string, number>; // currency → rate_to_aed

/**
 * Convert an amount from one currency to another via AED as the pivot.
 *   amount_in_to = amount_from × (from→aed) / (to→aed)
 */
export function convertCurrency(amount: number, from: string, to: string, fx: FxMap): number {
  if (from === to) return amount;
  const fromToAed = fx.get(from) ?? 1;
  const toToAed = fx.get(to) ?? 1;
  if (toToAed === 0) return 0;
  return amount * fromToAed / toToAed;
}

// ============================================================================
// Per-staff aggregation with payment-currency conversion
// ============================================================================

export interface StaffPayoutSummary {
  employee_id: string;
  payment_currency: string;
  deal_count: number;
  // What they earned per invoice currency (NOT converted, raw amounts)
  earned_per_invoice_currency: Record<string, number>; // { AED: 1234, SAR: 567, USD: 89 }
  // Final payable in their payment currency (sum of all earnings converted)
  total_payable_in_payment_currency: number;
  // AED-equivalent of the total (useful for company-wide totals)
  total_in_aed: number;
  // Role breakdown (for the dashboard split) — all in AED for easy summing
  per_role_aed: { originator: number; closer: number; sales_head: number; capped_combined: number };
}

/**
 * Aggregate per-staff totals across many deals, converting each chunk to the
 * staff's payment currency.
 *
 * @param deals - deals to aggregate
 * @param fx - currency → rate-to-AED lookup
 * @param staffCurrency - employee_id → payment currency lookup (defaults to AED)
 */
export function aggregateByStaff(
  deals: DealInput[],
  fx: FxMap,
  staffCurrency: Map<string, string>,
): Map<string, StaffPayoutSummary> {
  const map = new Map<string, StaffPayoutSummary>();

  for (const deal of deals) {
    for (const bonus of bonusForDeal(deal)) {
      const paymentCurrency = staffCurrency.get(bonus.employee_id) ?? "AED";

      if (!map.has(bonus.employee_id)) {
        map.set(bonus.employee_id, {
          employee_id: bonus.employee_id,
          payment_currency: paymentCurrency,
          deal_count: 0,
          earned_per_invoice_currency: {},
          total_payable_in_payment_currency: 0,
          total_in_aed: 0,
          per_role_aed: { originator: 0, closer: 0, sales_head: 0, capped_combined: 0 },
        });
      }
      const s = map.get(bonus.employee_id)!;
      s.deal_count += 1;

      // Track raw earnings per invoice currency
      const ic = bonus.invoice_currency;
      s.earned_per_invoice_currency[ic] = (s.earned_per_invoice_currency[ic] || 0)
        + bonus.bonus_in_invoice_currency;

      // Convert to payment currency and add to running total
      const inPayment = convertCurrency(
        bonus.bonus_in_invoice_currency,
        bonus.invoice_currency,
        paymentCurrency,
        fx,
      );
      s.total_payable_in_payment_currency += inPayment;

      // Convert to AED for company-wide totals
      const inAed = convertCurrency(bonus.bonus_in_invoice_currency, bonus.invoice_currency, "AED", fx);
      s.total_in_aed += inAed;

      // Role split in AED (for the dashboard's role columns)
      if (bonus.capped) {
        s.per_role_aed.capped_combined += inAed;
      } else {
        // Apportion the bonus across this person's roles by % share
        const totalPct = bonus.percent_applied;
        for (const role of bonus.roles) {
          const rolePct = ROLE_PCT[role] || 0;
          const portion = inAed * (rolePct / totalPct);
          if (role === "originator") s.per_role_aed.originator += portion;
          if (role === "closer")     s.per_role_aed.closer += portion;
          if (role === "sales_head") s.per_role_aed.sales_head += portion;
        }
      }
    }
  }

  // Round everything at the end
  for (const s of map.values()) {
    s.total_payable_in_payment_currency = round2(s.total_payable_in_payment_currency);
    s.total_in_aed = round2(s.total_in_aed);
    for (const c of Object.keys(s.earned_per_invoice_currency)) {
      s.earned_per_invoice_currency[c] = round2(s.earned_per_invoice_currency[c]);
    }
    s.per_role_aed.originator = round2(s.per_role_aed.originator);
    s.per_role_aed.closer = round2(s.per_role_aed.closer);
    s.per_role_aed.sales_head = round2(s.per_role_aed.sales_head);
    s.per_role_aed.capped_combined = round2(s.per_role_aed.capped_combined);
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

export function formatMoneyDecimal(n: number, currency = "AED"): string {
  return new Intl.NumberFormat("en", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}
