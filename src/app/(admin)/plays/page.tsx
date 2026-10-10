import { ComingSoon } from "@/components/ComingSoon";
import { requireAdmin } from "@/lib/session";

export default async function Page() {
  await requireAdmin();

  return (
    <ComingSoon
      title="Plays"
      intro="What people listen to, and how much of it counts."
      items={[
        "Plays per day: total, qualified and excluded (with reason)",
        "Breakdown by country, device and app version",
        "Top tracks and artists",
      ]}
    />
  );
}
