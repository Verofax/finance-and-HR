import { requirePermission } from "@/lib/auth";
import { ComingSoon } from "@/components/coming-soon";

export default async function PayrollPage() {
  await requirePermission("salary.view");
  return (
    <ComingSoon
      title="Payroll"
      phase="Phase 2"
      description="Run monthly payroll, mark salaries paid/pending, track deductions and reimbursements, and view employee-wise salary history. Coming next."
    />
  );
}
