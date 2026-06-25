import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";

function statusBadge(status: string) {
  switch (status) {
    case "pending":   return <span className="badge badge-amber">Pending</span>;
    case "approved":  return <span className="badge badge-green">Approved</span>;
    case "rejected":  return <span className="badge badge-red">Rejected</span>;
    case "cancelled": return <span className="badge badge-slate">Cancelled</span>;
    default:          return <span className="badge badge-slate">{status}</span>;
  }
}

function typeBadge(type: string) {
  const colors: Record<string, string> = {
    annual: "badge-navy", sick: "badge-amber", maternity: "badge-green",
    paternity: "badge-green", mourning: "badge-slate", haj: "badge-slate",
    unpaid: "badge-red", other: "badge-slate",
  };
  return <span className={`badge ${colors[type] || "badge-slate"} capitalize`}>{type}</span>;
}

export default async function LeaveAdminPage() {
  await requirePermission("leave.view");
  const supabase = await createClient();
  const year = new Date().getFullYear();

  const [
    { data: pending },
    { data: recent },
    { data: balances },
  ] = await Promise.all([
    supabase.from("leave_requests")
      .select("id, leave_type, start_date, end_date, days_count, reason, status, manager_email, created_at, employees:employee_id (id, full_name, employee_code, country)")
      .eq("status", "pending")
      .order("created_at", { ascending: false }),
    supabase.from("leave_requests")
      .select("id, leave_type, start_date, end_date, days_count, status, decided_at, decided_by_email, employees:employee_id (id, full_name, employee_code)")
      .in("status", ["approved", "rejected"])
      .order("decided_at", { ascending: false })
      .limit(20),
    supabase.from("current_leave_balances")
      .select("*")
      .eq("year", year)
      .order("full_name", { ascending: true }),
  ]);

  // Pivot balances: one row per employee, columns for annual + sick
  const balanceMap = new Map<string, any>();
  for (const b of balances ?? []) {
    if (!balanceMap.has(b.employee_id)) {
      balanceMap.set(b.employee_id, {
        employee_id: b.employee_id,
        full_name: b.full_name,
        employee_code: b.employee_code,
        department: b.department,
        country: b.country,
        manager_email: b.manager_email,
        annual: null,
        sick: null,
      });
    }
    const row = balanceMap.get(b.employee_id);
    if (b.leave_type === "annual") row.annual = b;
    if (b.leave_type === "sick") row.sick = b;
  }
  const balanceRows = Array.from(balanceMap.values());

  return (
    <div>
      <header className="flex items-end justify-between mb-6 flex-wrap gap-4">
        <div>
          <div className="text-[11px] tracking-[0.18em] uppercase font-bold text-navy-500 mb-2">Leave Management</div>
          <h1 className="font-display text-3xl font-extrabold text-navy-700">Leave</h1>
          <p className="text-sm text-slate-500 mt-1">{year} balances · pending requests · recent decisions</p>
        </div>
        <Link href="/leave-request" target="_blank" className="btn-ghost">
          ↗ Open public submission form
        </Link>
      </header>

      {/* KPI strip */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="kpi-card">
          <div className="kpi-label">Pending Requests</div>
          <div className={`kpi-value ${(pending?.length ?? 0) > 0 ? "warning" : ""}`}>{pending?.length ?? 0}</div>
          <div className="kpi-meta">Awaiting manager approval</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Active Employees</div>
          <div className="kpi-value">{balanceRows.length}</div>
          <div className="kpi-meta">With leave balance tracked</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Annual Remaining (total)</div>
          <div className="kpi-value positive">
            {balanceRows.reduce((s, r) => s + Number(r.annual?.remaining_days ?? 0), 0).toFixed(0)}
            <span className="text-sm font-normal text-slate-500"> days</span>
          </div>
          <div className="kpi-meta">Across all staff</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Sick Remaining (total)</div>
          <div className="kpi-value positive">
            {balanceRows.reduce((s, r) => s + Number(r.sick?.remaining_days ?? 0), 0).toFixed(0)}
            <span className="text-sm font-normal text-slate-500"> days</span>
          </div>
          <div className="kpi-meta">Across all staff</div>
        </div>
      </section>

      {/* Pending requests */}
      <div className="section-card mb-6 p-0 overflow-x-auto">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <h2 className="font-display text-lg font-extrabold text-navy-700">Pending Requests</h2>
          <span className="text-xs text-slate-500">{pending?.length ?? 0} waiting on manager</span>
        </div>
        {(pending ?? []).length === 0 ? (
          <div className="text-center py-12 text-slate-500 text-sm">
            <div className="text-3xl mb-2">✓</div>
            All clear — no pending leave requests.
          </div>
        ) : (
          <table className="table-clean">
            <thead>
              <tr><th>Submitted</th><th>Employee</th><th>Type</th><th>From → To</th><th>Days</th><th>Manager</th><th></th></tr>
            </thead>
            <tbody>
              {(pending ?? []).map((r: any) => {
                const emp = Array.isArray(r.employees) ? r.employees[0] : r.employees;
                return (
                  <tr key={r.id}>
                    <td className="text-xs text-slate-500">{new Date(r.created_at).toLocaleString("en", { dateStyle: "short", timeStyle: "short" })}</td>
                    <td className="font-medium text-navy-700">{emp?.full_name}</td>
                    <td>{typeBadge(r.leave_type)}</td>
                    <td className="text-sm text-slate-700">{r.start_date} → {r.end_date}</td>
                    <td className="font-semibold">{r.days_count}</td>
                    <td className="text-xs text-slate-500">{r.manager_email}</td>
                    <td>{statusBadge(r.status)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Balances table */}
      <div className="section-card mb-6 p-0 overflow-x-auto">
        <div className="px-6 py-4 border-b border-slate-200">
          <h2 className="font-display text-lg font-extrabold text-navy-700">Balances · {year}</h2>
          <p className="text-xs text-slate-500 mt-0.5">Accrued + carry forward − taken = remaining</p>
        </div>
        <table className="table-clean">
          <thead>
            <tr>
              <th>Employee</th>
              <th>Country</th>
              <th colSpan={3} className="text-center">Annual Leave (24)</th>
              <th colSpan={3} className="text-center">Sick Leave (10)</th>
              <th>Manager</th>
            </tr>
            <tr style={{ background: "#f6f9ff" }}>
              <th></th>
              <th></th>
              <th className="text-right">Accrued</th>
              <th className="text-right">Taken</th>
              <th className="text-right">Remaining</th>
              <th className="text-right">Accrued</th>
              <th className="text-right">Taken</th>
              <th className="text-right">Remaining</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {balanceRows.map((r) => (
              <tr key={r.employee_id}>
                <td>
                  <Link href={`/employees/${r.employee_id}`} className="font-semibold text-navy-700 hover:underline">{r.full_name}</Link>
                  <div className="text-xs text-slate-400 font-mono">{r.employee_code}</div>
                </td>
                <td className="text-xs text-slate-500">{r.country ?? "—"}</td>
                <td className="text-right text-sm">{Number(r.annual?.accrued_days ?? 0).toFixed(1)}</td>
                <td className="text-right text-sm text-slate-500">{Number(r.annual?.taken_days ?? 0).toFixed(1)}</td>
                <td className="text-right font-semibold text-navy-700">{Number(r.annual?.remaining_days ?? 0).toFixed(1)}</td>
                <td className="text-right text-sm">{Number(r.sick?.accrued_days ?? 0).toFixed(1)}</td>
                <td className="text-right text-sm text-slate-500">{Number(r.sick?.taken_days ?? 0).toFixed(1)}</td>
                <td className="text-right font-semibold text-navy-700">{Number(r.sick?.remaining_days ?? 0).toFixed(1)}</td>
                <td className="text-xs text-slate-500">{r.manager_email}</td>
              </tr>
            ))}
            {balanceRows.length === 0 && (
              <tr><td colSpan={9} className="text-center py-12 text-slate-500 text-sm">No balances yet — run seed_staff.sql in Supabase to import.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Recent decisions */}
      <div className="section-card p-0 overflow-x-auto">
        <div className="px-6 py-4 border-b border-slate-200">
          <h2 className="font-display text-lg font-extrabold text-navy-700">Recent Decisions</h2>
        </div>
        {(recent ?? []).length === 0 ? (
          <div className="text-center py-10 text-slate-500 text-sm">No decisions yet.</div>
        ) : (
          <table className="table-clean">
            <thead>
              <tr><th>Decided</th><th>Employee</th><th>Type</th><th>Period</th><th>Days</th><th>By</th><th></th></tr>
            </thead>
            <tbody>
              {(recent ?? []).map((r: any) => {
                const emp = Array.isArray(r.employees) ? r.employees[0] : r.employees;
                return (
                  <tr key={r.id}>
                    <td className="text-xs text-slate-500">{r.decided_at ? new Date(r.decided_at).toLocaleString("en", { dateStyle: "short", timeStyle: "short" }) : "—"}</td>
                    <td className="font-medium">{emp?.full_name}</td>
                    <td>{typeBadge(r.leave_type)}</td>
                    <td className="text-sm text-slate-600">{r.start_date} → {r.end_date}</td>
                    <td className="font-semibold">{r.days_count}</td>
                    <td className="text-xs text-slate-500">{r.decided_by_email ?? "—"}</td>
                    <td>{statusBadge(r.status)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
