import { createServiceClient } from "@/lib/supabase/service";
import { LeaveRequestForm } from "./form";

export const metadata = {
  title: "Submit Leave Request — Verofax",
  robots: { index: false, follow: false },
};

export default async function LeaveRequestPage() {
  // Load active employees for the dropdown (service-role — public page, no login)
  const supabase = createServiceClient();
  const { data: employees } = await supabase
    .from("employees")
    .select("id, full_name, employee_code, country, manager_email")
    .eq("status", "active")
    .order("full_name", { ascending: true });

  return (
    <div className="min-h-screen" style={{ background: "linear-gradient(135deg, #f6f9ff 0%, #dbe4f3 100%)" }}>
      <div className="max-w-[640px] mx-auto px-6 py-12">
        <header className="text-center mb-8">
          <div className="text-[11px] font-bold tracking-[0.2em] uppercase text-navy-700 mb-2">VEROFAX</div>
          <h1 className="font-display text-3xl font-extrabold text-navy-700 mb-2">Submit Leave Request</h1>
          <p className="text-sm text-slate-500">Your manager will receive an email and decide. You'll be notified once approved or rejected.</p>
        </header>

        <LeaveRequestForm employees={employees ?? []} />

        <p className="text-xs text-slate-400 text-center mt-8">
          Verofax Finance Platform · Confidential internal use
        </p>
      </div>
    </div>
  );
}
