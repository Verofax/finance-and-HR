import { requirePermission } from "@/lib/auth";
import { ComingSoon } from "@/components/coming-soon";

export default async function ReportsPage() {
  await requirePermission("report.view");
  return (
    <ComingSoon
      title="Reports"
      phase="Phase 5"
      description="Payroll summary, paid-vs-pending, department salary cost, monthly trend, bonus pending, leave balance, air ticket balance, and final settlement reports — all filterable by period, department, employee, location, and status."
    />
  );
}
