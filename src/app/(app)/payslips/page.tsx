import { requirePermission } from "@/lib/auth";
import { ComingSoon } from "@/components/coming-soon";

export default async function PayslipsPage() {
  await requirePermission("payslip.generate");
  return (
    <ComingSoon
      title="Payslips"
      phase="Phase 4"
      description="Generate PDF payslips per employee, with Verofax branding, full breakdown, and leave summary. Stored against each employee profile."
    />
  );
}
