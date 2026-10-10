import { ComingSoon } from "@/components/ComingSoon";
import { requireAdmin } from "@/lib/session";

export default async function Page() {
  await requireAdmin();

  return (
    <ComingSoon
      title="Payouts"
      intro="Money going out to creators."
      items={[
        "Creator balances",
        "Payouts by status: pending, processing, paid, failed",
        "Stripe Connect transfers, retries and CSV export",
      ]}
    />
  );
}
