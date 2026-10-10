import { ComingSoon } from "@/components/ComingSoon";
import { requireAdmin } from "@/lib/session";

export default async function Page() {
  await requireAdmin();

  return (
    <ComingSoon
      title="Moderation"
      intro="Everything waiting for a human decision."
      items={[
        "Tracks in review: publish or send back to draft",
        "AI declarations pending review: approve or reject",
        "Splits that do not add up to 100 percent",
      ]}
    />
  );
}
