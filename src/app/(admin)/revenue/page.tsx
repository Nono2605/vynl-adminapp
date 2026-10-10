import { ComingSoon } from "@/components/ComingSoon";
import { requireAdmin } from "@/lib/session";

export default async function Page() {
  await requireAdmin();

  return (
    <ComingSoon
      title="Revenue"
      intro="Royalty periods and how each one is shared."
      items={[
        "Royalty periods: open or closed, total revenue",
        "Allocations per artist and per track",
        "Subscriber revenue from Stripe",
      ]}
    />
  );
}
