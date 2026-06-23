import { requireUser } from "@/lib/auth";
import { ComingSoon } from "@/components/coming-soon";

export default async function ImportExportPage() {
  await requireUser();
  return (
    <ComingSoon
      title="Import / Export"
      phase="Phase 3"
      description="Bulk-import employees, salary data, leave balances, bonuses, and benefits from Excel. Export payroll, employee, leave, and pending-dues reports as CSV or XLSX."
    />
  );
}
