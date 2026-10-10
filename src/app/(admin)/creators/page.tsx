import { ComingSoon } from "@/components/ComingSoon";
import { requireAdmin } from "@/lib/session";

export default async function Page() {
  await requireAdmin();

  return (
    <ComingSoon
      title="Creators"
      intro="Everyone who publishes music on Vynl."
      items={[
        "Creator accounts and artist profiles, verified badge",
        "Onboarding: accepted terms, provenance, rights ownership",
        "Catalog size, followers, plays and earnings per creator",
        "Stripe Connect status: KYC and payout readiness",
      ]}
    />
  );
}
