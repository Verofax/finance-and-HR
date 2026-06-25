import { requirePermission, can } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { aggregateByStaff, bonusForDeal, formatMoney, type DealInput } from "@/lib/commission";
import { YearSelector } from "./year-selector";

interface SearchParams { year?: string }

export default async function BonusPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requirePermission("bonus.view");
  const { year: yearParam } = await searchParams;
  const supabase = await createClient();

  const canEdit = can(user.role, "bonus.edit");

  // Load all years available + FX rates + employees + deals for selected year
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
  const fxMap = new Map<string, number>();
  for (const f of fxRows ?? []) fxMap.set(f.currency, Number(f.rate_to_aed));

  // Employee lookup
  const empMap = new Map<string, any>();
  for (const e of employees ?? []) empMap.set(e.id, e);

  // Hydrate deals with FX
  const deals: (DealInput & { client_name: string; invoice_number: string | null; invoice_amount_ex_vat: number; net_amount: number; received_percent: number; balance_to_receive: number })[] =
    (rawDeals ?? []).map((d: any) => ({
      ...d,
      amount_received: Number(d.amount_received ?? 0),
      third_party_expenses: Number(d.third_party_expenses ?? 0),
      marketing_allowance: Number(d.marketing_allowance ?? 0),
      fx_rate_to_aed: fxMap.get(d.currency) ?? 1,
    }));

  // Aggregate per-staff
  const perStaff = aggregateByStaff(deals);
  const staffRows = Array.from(perStaff.values())
    .sort((a, b) => b.total_in_aed - a.total_in_aed);

  // Totals
  const totalCommissionAed = staffRows.reduce((s, r) => s + r.total_in_aed, 0);
  const totalReceivedAed = deals.reduce((s, d) => s + d.amount_received * d.fx_rate_to_aed, 0);
  const totalNetAed = deals.reduce((s, d) => s + Number(d.net_amount ?? 0) * d.fx_rate_to_aed, 0);
  const totalOutstandingAed = deals.reduce((s, d) => s + Number(d.balance_to_receive ?? 0) * d.fx_rate_to_aed, 0);

  return (
    <div>
      <header className="flex items-end justify-between mb-6 flex-wrap gap-4">
        <div>
          <div className="text-[11px] tracking-[0.18em] uppercase font-bold text-navy-500 mb-2">Sales Commission</div>
          <h1 className="font-display text-3xl font-extrabold text-navy-700">Sales Bonus &amp; Commission</h1>
          <p className="text-sm text-slate-500 mt-1">
            Policy: 1% Originator + 4% Closer + 2% Sales Head · capped at 5% when same person fills all three · paid only on amounts received.
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
          <div className="kpi-label">Total Commission Payable</div>
          <div className="kpi-value">{formatMoney(totalCommissionAed)}</div>
          <div className="kpi-meta">{deals.length} deals · {selectedYear}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Net Revenue (year)</div>
          <div className="kpi-value">{formatMoney(totalNetAed)}</div>
          <div className="kpi-meta">After expenses, in AED</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Received</div>
          <div className="kpi-value positive">{formatMoney(totalReceivedAed)}</div>
          <div className="kpi-meta">Cash collected, in AED</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Outstanding</div>
          <div className={`kpi-value ${totalOutstandingAed > 0 ? "warning" : ""}`}>{formatMoney(totalOutstandingAed)}</div>
          <div className="kpi-meta">Balance to receive</div>
        </div>
      </section>

      {/* Staff-wise totals */}
      <div className="section-card mb-6 p-0 overflow-x-auto">
        <div className="px-6 py-4 border-b border-slate-200">
          <h2 className="font-display text-lg font-extrabold text-navy-700">Commission Payable — Staff-wise (AED)</h2>
          <p className="text-xs text-slate-500 mt-0.5">Auto-computed from deals · 5% cap applied where same person plays all three roles</p>
        </div>
        <table className="table-clean">
          <thead>
            <tr>
              <th>Staff</th>
              <th className="text-right">Originator (1%)</th>
              <th className="text-right">Closer (4%)</th>
              <th className="text-right">Sales Head (2%)</th>
              <th className="text-right">Capped Combined (5%)</th>
              <th className="text-right">Total AED</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {staffRows.length === 0 ? (
              <tr><td colSpan={7} className="text-center py-12 text-slate-500 text-sm">
                <div className="text-3xl mb-2">▲</div>
                No deals for {selectedYear} yet. {canEdit && <Link href="/bonus/new" className="text-navy-700 underline">Add the first one</Link>}
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
                        <div className="text-xs text-slate-400 font-mono">{emp?.employee_code}</div>
                      </td>
                      <td className="text-right text-sm">{s.per_role.originator_aed > 0 ? formatMoney(s.per_role.originator_aed) : "—"}</td>
                      <td className="text-right text-sm">{s.per_role.closer_aed > 0 ? formatMoney(s.per_role.closer_aed) : "—"}</td>
                      <td className="text-right text-sm">{s.per_role.sales_head_aed > 0 ? formatMoney(s.per_role.sales_head_aed) : "—"}</td>
                      <td className="text-right text-sm">{s.per_role.combined_capped_aed > 0 ? <span title="5% cap applied" className="text-amber-600">{formatMoney(s.per_role.combined_capped_aed)}</span> : "—"}</td>
                      <td className="text-right font-bold text-navy-700">{formatMoney(s.total_in_aed)}</td>
                      <td className="text-xs text-slate-500">{s.deal_count} deal{s.deal_count === 1 ? "" : "s"}</td>
                    </tr>
                  );
                })}
                <tr style={{ background: "#f6f9ff" }}>
                  <td className="font-bold text-navy-700">Total</td>
                  <td className="text-right font-semibold text-sm">{formatMoney(staffRows.reduce((s, r) => s + r.per_role.originator_aed, 0))}</td>
                  <td className="text-right font-semibold text-sm">{formatMoney(staffRows.reduce((s, r) => s + r.per_role.closer_aed, 0))}</td>
                  <td className="text-right font-semibold text-sm">{formatMoney(staffRows.reduce((s, r) => s + r.per_role.sales_head_aed, 0))}</td>
                  <td className="text-right font-semibold text-sm">{formatMoney(staffRows.reduce((s, r) => s + r.per_role.combined_capped_aed, 0))}</td>
                  <td className="text-right font-bold text-navy-700">{formatMoney(totalCommissionAed)}</td>
                  <td></td>
                </tr>
              </>
            )}
          </tbody>
        </table>
      </div>

      {/* All deals */}
      <div className="section-card p-0 overflow-x-auto">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <h2 className="font-display text-lg font-extrabold text-navy-700">Deals · {selectedYear}</h2>
          <span className="text-xs text-slate-500">{deals.length} total</span>
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
              <th className="text-right">Commission (AED)</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {deals.map((d) => {
              const dealBonus = bonusForDeal(d);
              const totalBonusAed = dealBonus.reduce((s, b) => s + b.bonus_in_aed, 0);
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
                  <td className="text-xs text-slate-500">{d.currency}</td>
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
                  <td className="text-right font-semibold text-navy-700">{totalBonusAed > 0 ? formatMoney(totalBonusAed) : "—"}</td>
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

