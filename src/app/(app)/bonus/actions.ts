"use server";

import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

interface DealPayload {
  year: number;
  client_name: string;
  invoice_number: string | null;
  currency: string;
  invoice_amount_ex_vat: number;
  third_party_expenses: number;
  marketing_allowance: number;
  amount_received: number;
  deal_originator_id: string | null;
  deal_closer_id: string | null;
  sales_head_id: string | null;
  status: string;
  payment_receipt_date: string | null;
  notes: string | null;
}

function parseForm(formData: FormData): DealPayload {
  const num = (k: string) => {
    const v = formData.get(k);
    if (!v) return 0;
    const n = Number(v);
    return isNaN(n) ? 0 : n;
  };
  const str = (k: string) => {
    const v = formData.get(k);
    const s = v ? String(v).trim() : "";
    return s.length > 0 ? s : null;
  };

  return {
    year: num("year") || new Date().getFullYear(),
    client_name: String(formData.get("client_name") || "").trim(),
    invoice_number: str("invoice_number"),
    currency: String(formData.get("currency") || "AED"),
    invoice_amount_ex_vat: num("invoice_amount_ex_vat"),
    third_party_expenses: num("third_party_expenses"),
    marketing_allowance: num("marketing_allowance"),
    amount_received: num("amount_received"),
    deal_originator_id: str("deal_originator_id"),
    deal_closer_id: str("deal_closer_id"),
    sales_head_id: str("sales_head_id"),
    status: String(formData.get("status") || "open"),
    payment_receipt_date: str("payment_receipt_date"),
    notes: str("notes"),
  };
}

export async function createDeal(formData: FormData) {
  const user = await requirePermission("bonus.edit");
  const payload = parseForm(formData);

  if (!payload.client_name) {
    throw new Error("Client name is required");
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("commission_deals")
    .insert({ ...payload, created_by: user.id, updated_by: user.id })
    .select("id")
    .single();

  if (error) throw new Error(error.message);
  revalidatePath("/bonus");
  redirect(`/bonus?year=${payload.year}`);
}

export async function updateDeal(id: string, formData: FormData) {
  const user = await requirePermission("bonus.edit");
  const payload = parseForm(formData);

  const supabase = await createClient();
  const { error } = await supabase
    .from("commission_deals")
    .update({ ...payload, updated_by: user.id, updated_at: new Date().toISOString() })
    .eq("id", id);

  if (error) throw new Error(error.message);
  revalidatePath("/bonus");
  redirect(`/bonus?year=${payload.year}`);
}

export async function deleteDeal(id: string, year: number) {
  await requirePermission("bonus.edit");
  const supabase = await createClient();
  const { error } = await supabase.from("commission_deals").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/bonus");
  redirect(`/bonus?year=${year}`);
}
