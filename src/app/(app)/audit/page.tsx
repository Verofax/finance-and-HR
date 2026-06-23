import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export default async function AuditLogsPage() {
  await requirePermission("*");
  const supabase = await createClient();
  const { data: logs } = await supabase
    .from("audit_logs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200);

  return (
    <div>
      <header className="mb-6">
        <div className="text-[11px] tracking-[0.18em] uppercase font-bold text-navy-500 mb-2">Security</div>
        <h1 className="font-display text-3xl font-extrabold text-navy-700">Audit Logs</h1>
        <p className="text-sm text-slate-500 mt-1">Most recent 200 actions across employees, salary, leave, benefits, bonus.</p>
      </header>
      <div className="section-card overflow-x-auto p-0">
        <table className="table-clean">
          <thead>
            <tr><th>When</th><th>Who</th><th>Action</th><th>Entity</th><th>ID</th></tr>
          </thead>
          <tbody>
            {(logs ?? []).length === 0 ? (
              <tr><td colSpan={5} className="text-center py-14 text-slate-500">No audit activity yet.</td></tr>
            ) : (logs ?? []).map((l: any) => (
              <tr key={l.id}>
                <td className="text-xs text-slate-500 font-mono">{new Date(l.created_at).toLocaleString("en", { dateStyle: "short", timeStyle: "medium" })}</td>
                <td>
                  <div className="font-medium text-slate-700 text-sm">{l.user_email}</div>
                  {l.user_role && <div className="text-[10px] uppercase tracking-wider text-slate-400">{l.user_role}</div>}
                </td>
                <td><span className={`badge ${l.action === "insert" ? "badge-green" : l.action === "delete" ? "badge-red" : "badge-amber"}`}>{l.action}</span></td>
                <td className="text-sm text-slate-700 capitalize">{l.entity_type.replace(/_/g, " ")}</td>
                <td className="text-xs font-mono text-slate-400 truncate max-w-[200px]">{l.entity_id}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
