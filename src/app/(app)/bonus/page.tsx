import { requirePermission, can } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { aggregateByStaff, bonusForDeal, convertCurrency, formatMoney, formatMoneyDecimal, type DealInput, type FxMap } from "@/lib/commission";
import { YearSelector } from "./year-selector";

interface SearchParams { year?: string }

export default async function BonusPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requirePermission("bonus.view");
  const { year: yearParam } = await searchParams;
  const supabase = await createClient();

  const canEdit = can(user.role, "bonus.edit");

  const [{ data: yearRows }, { data: fxRows }, { data: employees }] = await Promise.all([
    supabase.from("commission_deals").select("year").order("year", { ascending: false }),
    supabase.from("fx_rates").select("*"),
    supabase.from("employees").select("id, full_name, employee_code, country, salary_currency"),
  ]);

  const availableYears = Array.from(new Set((yearRows ?? []).map((r: any) => r.year))).sort((a: any, b: any) => b - a);
  const selectedYear = yearParam ? Number(yearParam) : (availableYears[0] ?? new Date().getFullYear());

  const { data: rawDeals } = await supabase
    .from("commission_deals")
    .select("*")
    .eq("year", selectedYear)
    .order("created_at", { ascending: true });

  // FX lookup
  const fxMap: FxMap = new Map<string, number>();
  for (const f of fxRows ?? []) fxMap.set(f.currency, Number(f.rate_to_aed));

  // Employee lookup + payment-currency map
  const empMap = new Map<string, any>();
  const staffCurrency = new Map<string, string>();
  for (const e of employees ?? []) {
    empMap.set(e.id, e);
    staffCurrency.set(e.id, e.salary_currency || "AED");
  }

  const deals: (DealInput & any)[] = (rawDeals ?? []).map((d: any) => ({
    ...d,
    amount_received: Number(d.amount_received ?? 0),
    third_party_expenses: Number(d.third_party_expenses ?? 0),
    marketing_allowance: Number(d.marketing_allowance ?? 0),
  }));

  // Aggregate per-staff with payment-currency conversion
  const perStaff = aggregateByStaff(deals, fxMap, staffCurrency);
  const staffRows = Array.from(perStaff.values()).sort((a, b) => b.total_in_aed - a.total_in_aed);

  // Company-wide totals (always in AED for comparability)
  const totalCommissionAed = staffRows.reduce((s, r) => s + r.total_in_aed, 0);
  const totalReceivedAed = deals.reduce((s, d) => s + convertCurrency(d.amount_received, d.currency, "AED", fxMap), 0);
  const totalNetAed = deals.reduce((s, d) => s + convertCurrency(Number(d.net_amount ?? 0), d.currency, "AED", fxMap), 0);
  const totalOutstandingAed = deals.reduce((s, d) => s + convertCurrency(Number(d.balance_to_receive ?? 0), d.currency, "AED", fxMap), 0);

  return (
    <div>
      <header className="flex items-end justify-between mb-6 flex-wrap gap-4">
        <div>
          <div className="text-[11px] tracking-[0.18em] uppercase font-bold text-navy-500 mb-2">Sales Commission</div>
          <h1 className="font-display text-3xl font-extrabold text-navy-700">Sales Bonus &amp; Commission</h1>
          <p className="text-sm text-slate-500 mt-1">
            1% Originator + 4% Closer + 2% Sales Head · 5% cap when same person plays all three · earned in invoice currency, paid in staff's region currency.
          </p>
        </div>
        <div className="flex gap-2">
          <YearSelector available={availableYears} selected={selectedYear} />
          {canEdit && <Link href="/bonus/new" className="btn-primary">+ Add Deal</Link>}
        </div>
      </header>

      {/* KPI strip */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="kpi-card">
          <div className="kpi-label">Total Commission (AED equiv)</div>
          <div className="kpi-value">{formatMoney(totalCommissionAed)}</div>
          <div className="kpi-meta">{deals.length} deals · {selectedYear}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Net Revenue (AED equiv)</div>
          <div className="kpi-value">{formatMoney(totalNetAed)}</div>
          <div className="kpi-meta">After expenses, sum across currencies</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Received (AED equiv)</div>
          <div className="kpi-value positive">{formatMoney(totalReceivedAed)}</div>
          <div className="kpi-meta">Cash collected, sum across currencies</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Outstanding (AED equiv)</div>
          <div className={`kpi-value ${totalOutstandingAed > 0 ? "warning" : ""}`}>{formatMoney(totalOutstandingAed)}</div>
          <div className="kpi-meta">Balance to receive</div>
        </div>
      </section>

      {/* Staff-wise payout table */}
      <div className="section-card mb-6 p-0 overflow-x-auto">
        <div className="px-6 py-4 border-b border-slate-200">
          <h2 className="font-display text-lg font-extrabold text-navy-700">Payout — Each Staff in Their Region Currency</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Commission earned in invoice currency · then converted to each staff's region currency for payment
          </p>
        </div>
        <table className="table-clean">
          <thead>
            <tr>
              <th>Staff</th>
              <th>Pay Currency</th>
              <th>Earned (per invoice currency)</th>
              <th className="text-right">Total Payable</th>
              <th className="text-right">≈ AED Equiv</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {staffRows.length === 0 ? (
              <tr><td colSpan={6} className="text-center py-12 text-slate-500 text-sm">
                <div className="text-3xl mb-2">▲</div>
                No deals for {selectedYear}. {canEdit && <Link href="/bonus/new" className="text-navy-700 underline">Add the first one</Link>}
              </td></tr>
            ) : (
              <>
                {staffRows.map((s) => {
                  const emp = empMap.get(s.employee_id);
                  return (
                    <tr key={s.employee_id}>
                      <td>
                        <Link href={`/bonus/staff/${s.employee_id}?year=${selectedYear}`} className="font-semibold text-navy-700 hover:underline">
                          {emp?.full_name ?? "—"}
                        </Link>
                        <div className="text-xs text-slate-400 font-mono">{emp?.employee_code} · {emp?.country ?? "—"}</div>
                      </td>
                      <td>
                        <span className="badge badge-navy">{s.payment_currency}</span>
                      </td>
                      <td>
                        <div className="flex flex-wrap gap-2 text-xs">
                          {Object.entries(s.earned_per_invoice_currency).map(([cur, amt]) => (
                            <span key={cur} className="bg-slate-100 px-2 py-1 rounded font-mono">
                              {amt.toLocaleString("en", { maximumFractionDigits: 2 })} <span className="text-slate-500">{cur}</span>
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="text-right">
                        <div className="font-bold text-navy-700 text-base">
                          {formatMoneyDecimal(s.total_payable_in_payment_currency, s.payment_currency)}
                        </div>
                      </td>
                      <td className="text-right text-sm text-slate-500">{formatMoney(s.total_in_aed)}</td>
                      <td className="text-xs text-slate-500">{s.deal_count} deal{s.deal_count === 1 ? "" : "s"}</td>
                    </tr>
                  );
                })}
                <tr style={{ background: "#f6f9ff" }}>
                  <td colSpan={4} className="font-bold text-navy-700 text-right">Grand Total (AED equivalent)</td>
                  <td className="text-right font-bold text-navy-700 text-lg">{formatMoney(totalCommissionAed)}</td>
                  <td></td>
                </tr>
              </>
            )}
          </tbody>
        </table>
      </div>

      {/* All deals — kept in invoice currency, AED shown for comparison */}
      <div className="section-card p-0 overflow-x-auto">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <h2 className="font-display text-lg font-extrabold text-navy-700">Deals · {selectedYear}</h2>
          <span className="text-xs text-slate-500">{deals.length} total · amounts in invoice currency</span>
        </div>
        <table className="table-clean">
          <thead>
            <tr>
              <th>Client</th>
              <th>Currency</th>
              <th className="text-right">Invoice</th>
              <th className="text-right">Expenses</th>
              <th className="text-right">Net</th>
              <th className="text-right">Received</th>
              <th className="text-right">%</th>
              <th>Originator</th>
              <th>Closer</th>
              <th>Sales Head</th>
              <th className="text-right">Commission (invoice cur)</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {deals.map((d) => {
              const dealBonus = bonusForDeal(d);
              const totalBonusInvoiceCur = dealBonus.reduce((s, b) => s + b.bonus_in_invoice_currency, 0);
              const orig = empMap.get(d.deal_originator_id ?? "");
              const closer = empMap.get(d.deal_closer_id ?? "");
              const head = empMap.get(d.sales_head_id ?? "");
              return (
                <tr key={d.id}>
                  <td>
                    {canEdit ? (
                      <Link href={`/bonus/${d.id}`} className="font-semibold text-navy-700 hover:underline">{d.client_name}</Link>
                    ) : (
                      <span className="font-semibold text-navy-700">{d.client_name}</span>
                    )}
                    {d.invoice_number && <div className="text-xs text-slate-400 font-mono">{d.invoice_number}</div>}
                  </td>
                  <td className="text-xs"><span className="badge badge-slate">{d.currency}</span></td>
                  <td className="text-right text-sm">{Number(d.invoice_amount_ex_vat).toLocaleString("en", { maximumFractionDigits: 0 })}</td>
                  <td className="text-right text-sm text-slate-500">
                    {Number(d.third_party_expenses) > 0 ? Number(d.third_party_expenses).toLocaleString("en", { maximumFractionDigits: 0 }) : "—"}
                    {Number(d.marketing_allowance) > 0 && <div className="text-[10px] text-emerald-600">+{Number(d.marketing_allowance).toLocaleString("en", { maximumFractionDigits: 0 })} mkt</div>}
                  </td>
                  <td className="text-right text-sm font-medium">{Number(d.net_amount).toLocaleString("en", { maximumFractionDigits: 0 })}</td>
                  <td className="text-right text-sm">{d.amount_received.toLocaleString("en", { maximumFractionDigits: 0 })}</td>
                  <td className="text-right text-xs">
                    <span className={`badge ${d.received_percent >= 100 ? "badge-green" : d.received_percent > 0 ? "badge-amber" : "badge-red"}`}>
                      {Number(d.received_percent).toFixed(0)}%
                    </span>
                  </td>
                  <td className="text-xs text-slate-700">{orig?.full_name ?? <span className="text-slate-300">—</span>}</td>
                  <td className="text-xs text-slate-700">{closer?.full_name ?? <span className="text-slate-300">—</span>}</td>
                  <td className="text-xs text-slate-700">{head?.full_name ?? <span className="text-slate-300">—</span>}</td>
                  <td className="text-right font-semibold text-navy-700">
                    {totalBonusInvoiceCur > 0 ? (
                      <>
                        {totalBonusInvoiceCur.toLocaleString("en", { maximumFractionDigits: 2 })}
                        <span className="text-xs text-slate-400 ml-1">{d.currency}</span>
                      </>
                    ) : "—"}
                  </td>
                  <td>
                    <span className={`badge ${d.status === "open" ? "badge-green" : d.status === "cancelled" ? "badge-red" : "badge-slate"}`}>{d.status}</span>
                  </td>
                </tr>
              );
            })}
            {deals.length === 0 && (
              <tr><td colSpan={12} className="text-center py-10 text-slate-500 text-sm">No deals for {selectedYear}.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
