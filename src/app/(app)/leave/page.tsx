import { requirePermission } from "@/lib/auth";
import { ComingSoon } from "@/components/coming-soon";

export default async function LeavePage() {
  await requirePermission("leave.view");
  return (
    <ComingSoon
      title="Leave Management"
      phase="Phase 2"
      description="Quarterly accrual, leave taken, unpaid leave, manual adjustments, and per-employee leave history with low-balance alerts."
    />
  );
}
