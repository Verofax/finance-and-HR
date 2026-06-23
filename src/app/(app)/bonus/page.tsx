import { requirePermission } from "@/lib/auth";
import { ComingSoon } from "@/components/coming-soon";

export default async function BonusPage() {
  await requirePermission("bonus.view");
  return (
    <ComingSoon
      title="Sales Bonus / Commission"
      phase="Phase 2"
      description="Target vs achieved, commission percentage or fixed bonus, bonus due/paid/pending, with month and quarter filters."
    />
  );
}
