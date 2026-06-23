import { requirePermission } from "@/lib/auth";
import { ComingSoon } from "@/components/coming-soon";

export default async function BenefitsPage() {
  await requirePermission("benefits.view");
  return (
    <ComingSoon
      title="Benefits &amp; Credits"
      phase="Phase 2"
      description="Air ticket balance, bonus, sales commission, reimbursement, expense claim, and any custom credit/debit entry — each with amount, status, notes, and attachment."
    />
  );
}
