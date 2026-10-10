import { ComingSoon } from "@/components/ComingSoon";
import { requireAdmin } from "@/lib/session";

export default async function Page() {
  await requireAdmin();

  return (
    <ComingSoon
      title="Fraud"
      intro="Suspicious activity detected on the platform."
      items={[
        "Fraud events by severity, with the plays involved",
        "Fraud scores per user, track and session",
        "Resolve an event, exclude plays",
      ]}
    />
  );
}
