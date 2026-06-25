import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { DealForm } from "../deal-form";
import { updateDeal, deleteDeal } from "../actions";

export default async function EditDealPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requirePermission("bonus.edit");
  const supabase = await createClient();

  const [{ data: deal }, { data: employees }, { data: fxRates }] = await Promise.all([
    supabase.from("commission_deals").select("*").eq("id", id).maybeSingle(),
    supabase.from("employees").select("id, full_name, employee_code").eq("status", "active").order("full_name"),
    supabase.from("fx_rates").select("currency, rate_to_aed"),
  ]);

  if (!deal) notFound();

  const bound = updateDeal.bind(null, id);

  return (
    <div>
      <header className="mb-6 flex items-end justify-between flex-wrap gap-3">
        <div>
          <a href={`/bonus?year=${deal.year}`} className="text-xs text-slate-500 hover:text-navy-700">← Back to commission</a>
          <h1 className="font-display text-3xl font-extrabold text-navy-700 mt-2">Edit Deal · {deal.client_name}</h1>
          <p className="text-sm text-slate-500 mt-1">All changes are auto-audited.</p>
        </div>
        <form action={deleteDeal.bind(null, id, deal.year)}>
          <button
            type="submit"
            className="text-sm text-red-600 hover:bg-red-50 px-4 py-2 rounded-lg border border-red-200"
            onClick={(e) => {
              if (!confirm(`Delete deal "${deal.client_name}"? This cannot be undone.`)) e.preventDefault();
            }}
          >
            Delete Deal
          </button>
        </form>
      </header>

      <DealForm
        initial={{
          id: deal.id,
          year: deal.year,
          client_name: deal.client_name,
          invoice_number: deal.invoice_number ?? "",
          currency: deal.currency,
          invoice_amount_ex_vat: Number(deal.invoice_amount_ex_vat ?? 0),
          third_party_expenses: Number(deal.third_party_expenses ?? 0),
          marketing_allowance: Number(deal.marketing_allowance ?? 0),
          amount_received: Number(deal.amount_received ?? 0),
          deal_originator_id: deal.deal_originator_id ?? "",
          deal_closer_id: deal.deal_closer_id ?? "",
          sales_head_id: deal.sales_head_id ?? "",
          status: deal.status,
          payment_receipt_date: deal.payment_receipt_date ?? "",
          notes: deal.notes ?? "",
        }}
        employees={employees ?? []}
        fxRates={fxRates ?? []}
        action={bound}
      />
    </div>
  );
}
