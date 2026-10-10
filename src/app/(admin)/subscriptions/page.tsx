import { ComingSoon } from "@/components/ComingSoon";
import { requireAdmin } from "@/lib/session";

export default async function Page() {
  await requireAdmin();

  return (
    <ComingSoon
      title="Subscriptions"
      intro="Who pays, who is on trial, who is free."
      items={[
        "Paying (active), trialing, at risk (past due), canceled and expired",
        "Free users: no active subscription",
        "Plan breakdown and upcoming period ends",
      ]}
    />
  );
}
