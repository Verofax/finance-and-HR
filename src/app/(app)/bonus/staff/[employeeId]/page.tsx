import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { bonusForDeal, formatMoney, type DealInput } from "@/lib/commission";

interface PageProps {
  params: Promise<{ employeeId: string }>;
  searchParams: Promise<{ year?: string }>;
}

export default async function StaffCommissionPage({ params, searchParams }: PageProps) {
  await requirePermission("bonus.view");
  const { employeeId } = await params;
  const { year: yearParam } = await searchParams;
  const supabase = await createClient();

  const [{ data: employee }, { data: fxRates }] = await Promise.all([
    supabase.from("employees").select("*").eq("id", employeeId).maybeSingle(),
    supabase.from("fx_rates").select("currency, rate_to_aed"),
  ]);

  if (!employee) notFound();

  const year = yearParam ? Number(yearParam) : new Date().getFullYear();

  // All deals where this person plays any role
  const { data: rawDeals } = await supabase
    .from("commission_deals")
    .select("*")
    .or(`deal_originator_id.eq.${employeeId},deal_closer_id.eq.${employeeId},sales_head_id.eq.${employeeId}`)
    .eq("year", year)
    .order("created_at", { ascending: true });

  const fxMap = new Map<string, number>();
  for (const f of fxRates ?? []) fxMap.set(f.currency, Number(f.rate_to_aed));

  const deals: (DealInput & any)[] = (rawDeals ?? []).map((d: any) => ({
    ...d,
    amount_received: Number(d.amount_received ?? 0),
    third_party_expenses: Number(d.third_party_expenses ?? 0),
    marketing_allowance: Number(d.marketing_allowance ?? 0),
    fx_rate_to_aed: fxMap.get(d.currency) ?? 1,
  }));

  // Per-deal breakdown for this employee
  const rows = deals.map((d) => {
    const all = bonusForDeal(d);
    const mine = all.find((b) => b.employee_id === employeeId);
    return { deal: d, mine };
  }).filter((r) => r.mine);

  const totalAed = rows.reduce((s, r) => s + (r.mine?.bonus_in_aed ?? 0), 0);

  return (
    <div>
      <header className="mb-6">
        <Link href={`/bonus?year=${year}`} className="text-xs text-slate-500 hover:text-navy-700">← Back to commission</Link>
        <div className="mt-2 flex items-end justify-between flex-wrap gap-4">
          <div>
            <h1 className="font-display text-3xl font-extrabold text-navy-700">{employee.full_name}</h1>
            <p className="text-sm text-slate-500 mt-1">Commission breakdown · {year}</p>
          </div>
          <div className="kpi-card" style={{ minWidth: 240 }}>
            <div className="kpi-label">Total Commission ({year})</div>
            <div className="kpi-value">{formatMoney(totalAed)}</div>
            <div className="kpi-meta">{rows.length} deal{rows.length === 1 ? "" : "s"}</div>
          </div>
        </div>
      </header>

      <div className="section-card p-0 overflow-x-auto">
        <table className="table-clean">
          <thead>
            <tr>
              <th>Client</th>
              <th>Currency</th>
              <th>Roles</th>
              <th className="text-right">Net Base</th>
              <th className="text-right">%</th>
              <th className="text-right">Bonus (curr)</th>
              <th className="text-right">Bonus AED</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={8} className="text-center py-12 text-slate-500 text-sm">No deals for {employee.full_name} in {year}.</td></tr>
            ) : (
              <>
                {rows.map(({ deal, mine }) => (
                  <tr key={deal.id}>
                    <td>
                      <Link href={`/bonus/${deal.id}`} className="font-semibold text-navy-700 hover:underline">{deal.client_name}</Link>
                      {deal.invoice_number && <div className="text-xs text-slate-400 font-mono">{deal.invoice_number}</div>}
                    </td>
                    <td className="text-xs text-slate-500">{deal.currency}</td>
                    <td className="text-xs">
                      <div className="flex flex-wrap gap-1">
                        {mine!.roles.map((r) => (
                          <span key={r} className="badge badge-navy capitalize">{r.replace("_", " ")}</span>
                        ))}
                        {mine!.capped && <span className="badge badge-amber">5% cap</span>}
                      </div>
                    </td>
                    <td className="text-right text-sm">{mine!.base_amount.toLocaleString("en", { maximumFractionDigits: 0 })}</td>
                    <td className="text-right text-sm font-semibold">{mine!.percent_applied}%</td>
                    <td className="text-right text-sm">{mine!.bonus_in_currency.toLocaleString("en", { maximumFractionDigits: 2 })}</td>
                    <td className="text-right font-bold text-navy-700">{formatMoney(mine!.bonus_in_aed)}</td>
                    <td>
                      <span className={`badge ${deal.status === "open" ? "badge-green" : deal.status === "cancelled" ? "badge-red" : "badge-slate"}`}>{deal.status}</span>
                    </td>
                  </tr>
                ))}
                <tr style={{ background: "#f6f9ff" }}>
                  <td colSpan={6} className="font-bold text-navy-700 text-right">Total</td>
                  <td className="text-right font-bold text-navy-700 text-lg">{formatMoney(totalAed)}</td>
                  <td></td>
                </tr>
              </>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
