"use client";

import { useMemo, useState } from "react";
import {
  ORIGINATOR_PCT, CLOSER_PCT, SALES_HEAD_PCT, TRIPLE_ROLE_CAP_PCT,
  bonusForDeal, formatMoney,
} from "@/lib/commission";

interface Employee {
  id: string;
  full_name: string;
  employee_code: string;
}

interface FxRate { currency: string; rate_to_aed: number }

interface InitialDeal {
  id?: string;
  year: number;
  client_name: string;
  invoice_number: string;
  currency: string;
  invoice_amount_ex_vat: number;
  third_party_expenses: number;
  marketing_allowance: number;
  amount_received: number;
  deal_originator_id: string;
  deal_closer_id: string;
  sales_head_id: string;
  status: string;
  payment_receipt_date: string;
  notes: string;
}

const CURRENCIES = ["AED", "SAR", "USD", "EUR", "GBP", "EGP", "INR"];

export function DealForm({
  initial,
  employees,
  fxRates,
  action,
}: {
  initial: InitialDeal;
  employees: Employee[];
  fxRates: FxRate[];
  action: (formData: FormData) => Promise<void>;
}) {
  const [year, setYear] = useState(initial.year);
  const [currency, setCurrency] = useState(initial.currency);
  const [invoiceAmount, setInvoiceAmount] = useState(initial.invoice_amount_ex_vat);
  const [expenses, setExpenses] = useState(initial.third_party_expenses);
  const [marketing, setMarketing] = useState(initial.marketing_allowance);
  const [received, setReceived] = useState(initial.amount_received);
  const [originator, setOriginator] = useState(initial.deal_originator_id);
  const [closer, setCloser] = useState(initial.deal_closer_id);
  const [head, setHead] = useState(initial.sales_head_id);

  const fxMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const f of fxRates) m.set(f.currency, Number(f.rate_to_aed));
    return m;
  }, [fxRates]);

  // Live commission preview
  const preview = useMemo(() => {
    return bonusForDeal({
      id: "preview",
      currency,
      amount_received: received,
      third_party_expenses: expenses,
      marketing_allowance: marketing,
      deal_originator_id: originator || null,
      deal_closer_id: closer || null,
      sales_head_id: head || null,
      status: "open",
      fx_rate_to_aed: fxMap.get(currency) ?? 1,
    });
  }, [currency, received, expenses, marketing, originator, closer, head, fxMap]);

  const empById = useMemo(() => {
    const m = new Map<string, Employee>();
    for (const e of employees) m.set(e.id, e);
    return m;
  }, [employees]);

  const totalPreviewAed = preview.reduce((s, p) => s + p.bonus_in_aed, 0);
  const netReceived = Math.max(received - Math.max(expenses - marketing, 0), 0);

  return (
    <form action={action} className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 space-y-6">
        {/* Basic */}
        <div className="section-card">
          <h2 className="font-display text-lg font-extrabold text-navy-700 mb-4">Deal Details</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <Field label="Year *">
              <input type="number" name="year" required value={year} onChange={(e) => setYear(Number(e.target.value))} className="input-field" min={2020} max={2099} />
            </Field>
            <Field label="Status">
              <select name="status" defaultValue={initial.status} className="input-field">
                <option value="open">Open</option>
                <option value="cancelled">Cancelled</option>
                <option value="refunded">Refunded</option>
                <option value="archived">Archived</option>
              </select>
            </Field>
            <Field label="Currency *">
              <select name="currency" value={currency} onChange={(e) => setCurrency(e.target.value)} className="input-field">
                {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="Client Name *" className="md:col-span-2">
              <input type="text" name="client_name" required defaultValue={initial.client_name} className="input-field" />
            </Field>
            <Field label="Invoice No.">
              <input type="text" name="invoice_number" defaultValue={initial.invoice_number} className="input-field font-mono text-xs" />
            </Field>
          </div>
        </div>

        {/* Money */}
        <div className="section-card">
          <h2 className="font-display text-lg font-extrabold text-navy-700 mb-4">Money <span className="text-sm font-normal text-slate-500 ml-2">(all in {currency})</span></h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Field label="Invoice (ex VAT) *">
              <input type="number" step="0.01" name="invoice_amount_ex_vat" required value={invoiceAmount} onChange={(e) => setInvoiceAmount(Number(e.target.value))} className="input-field" />
            </Field>
            <Field label="Third-party Expenses">
              <input type="number" step="0.01" name="third_party_expenses" value={expenses} onChange={(e) => setExpenses(Number(e.target.value))} className="input-field" />
            </Field>
            <Field label="Marketing Allowance">
              <input type="number" step="0.01" name="marketing_allowance" value={marketing} onChange={(e) => setMarketing(Number(e.target.value))} className="input-field" />
              <p className="text-[10px] text-slate-400 mt-1">Offsets expenses (not deducted from net)</p>
            </Field>
            <Field label="Amount Received *">
              <input type="number" step="0.01" name="amount_received" required value={received} onChange={(e) => setReceived(Number(e.target.value))} className="input-field" />
            </Field>
            <Field label="Payment Receipt Date">
              <input type="date" name="payment_receipt_date" defaultValue={initial.payment_receipt_date} className="input-field" />
            </Field>
          </div>
          <div className="mt-4 p-3 rounded-lg text-sm bg-slate-50 border border-slate-200">
            <span className="text-slate-500">Net commissionable: </span>
            <strong className="text-navy-700">{netReceived.toLocaleString("en")} {currency}</strong>
            <span className="text-slate-400 ml-2">= received − max(expenses − marketing, 0)</span>
          </div>
        </div>

        {/* Roles */}
        <div className="section-card">
          <h2 className="font-display text-lg font-extrabold text-navy-700 mb-4">Roles</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Field label={`Originator (${ORIGINATOR_PCT}%)`}>
              <EmployeeSelect name="deal_originator_id" value={originator} onChange={setOriginator} employees={employees} />
            </Field>
            <Field label={`Closer (${CLOSER_PCT}%)`}>
              <EmployeeSelect name="deal_closer_id" value={closer} onChange={setCloser} employees={employees} />
            </Field>
            <Field label={`Sales Head (${SALES_HEAD_PCT}%)`}>
              <EmployeeSelect name="sales_head_id" value={head} onChange={setHead} employees={employees} />
            </Field>
          </div>
          <p className="text-xs text-slate-500 mt-3">
            If the same person fills all three roles, the system caps their commission at <strong>{TRIPLE_ROLE_CAP_PCT}%</strong> (not the cumulative 7%) per policy.
          </p>
        </div>

        {/* Notes */}
        <div className="section-card">
          <h2 className="font-display text-lg font-extrabold text-navy-700 mb-4">Notes</h2>
          <textarea name="notes" defaultValue={initial.notes} rows={3} className="input-field resize-none" placeholder="Any context, special conditions, deductions" />
        </div>

        <div className="flex gap-3">
          <button type="submit" className="btn-primary">
            {initial.id ? "Save Changes" : "Create Deal"}
          </button>
          <a href={`/bonus?year=${year}`} className="btn-ghost">Cancel</a>
        </div>
      </div>

      {/* Live preview */}
      <aside className="space-y-4">
        <div className="section-card sticky" style={{ top: 16 }}>
          <div className="text-[11px] uppercase tracking-wider font-bold text-navy-500 mb-2">Live Commission Preview</div>
          <div className="font-display text-3xl font-extrabold text-navy-700 mb-1">
            {totalPreviewAed > 0 ? formatMoney(totalPreviewAed) : "—"}
          </div>
          <p className="text-xs text-slate-500 mb-4">Total payable in AED (1 {currency} = {(fxMap.get(currency) ?? 1).toFixed(4)} AED)</p>

          {preview.length === 0 ? (
            <p className="text-sm text-slate-500 italic">Fill in amounts + roles to see the calculation.</p>
          ) : (
            <ul className="space-y-3 text-sm">
              {preview.map((p) => {
                const emp = empById.get(p.employee_id);
                return (
                  <li key={p.employee_id} className="border-t border-slate-100 pt-3 first:border-t-0 first:pt-0">
                    <div className="flex items-baseline justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-semibold text-navy-700 truncate">{emp?.full_name ?? "—"}</div>
                        <div className="text-xs text-slate-500 capitalize">{p.roles.join(" + ")}</div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="font-bold text-navy-700">{formatMoney(p.bonus_in_aed)}</div>
                        <div className="text-[10px] text-slate-400">{p.percent_applied}% on {p.base_amount.toLocaleString("en", { maximumFractionDigits: 0 })} {p.base_currency}</div>
                      </div>
                    </div>
                    {p.capped && (
                      <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 px-2 py-1 rounded mt-2">
                        ⚠ 5% cap applied (would have been 7% cumulative)
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </aside>
    </form>
  );
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">{label}</label>
      {children}
    </div>
  );
}

function EmployeeSelect({ name, value, onChange, employees }: { name: string; value: string; onChange: (v: string) => void; employees: Employee[] }) {
  return (
    <select name={name} value={value} onChange={(e) => onChange(e.target.value)} className="input-field">
      <option value="">— None —</option>
      {employees.map((e) => <option key={e.id} value={e.id}>{e.full_name}</option>)}
    </select>
  );
}
