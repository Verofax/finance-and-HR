import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { DealForm } from "../deal-form";
import { createDeal } from "../actions";

export default async function NewDealPage() {
  await requirePermission("bonus.edit");
  const supabase = await createClient();

  const [{ data: employees }, { data: fxRates }] = await Promise.all([
    supabase.from("employees").select("id, full_name, employee_code, salary_currency").eq("status", "active").order("full_name"),
    supabase.from("fx_rates").select("currency, rate_to_aed"),
  ]);

  return (
    <div>
      <header className="mb-6">
        <a href="/bonus" className="text-xs text-slate-500 hover:text-navy-700">← Back to commission</a>
        <h1 className="font-display text-3xl font-extrabold text-navy-700 mt-2">Add Deal</h1>
        <p className="text-sm text-slate-500 mt-1">Commission is auto-computed and previewed on the right as you fill in.</p>
      </header>

      <DealForm
        initial={{
          year: new Date().getFullYear(),
          client_name: "",
          invoice_number: "",
          currency: "AED",
          invoice_amount_ex_vat: 0,
          third_party_expenses: 0,
          marketing_allowance: 0,
          amount_received: 0,
          deal_originator_id: "",
          deal_closer_id: "",
          sales_head_id: "",
          status: "open",
          payment_receipt_date: "",
          notes: "",
        }}
        employees={employees ?? []}
        fxRates={fxRates ?? []}
        action={createDeal}
      />
    </div>
  );
}
