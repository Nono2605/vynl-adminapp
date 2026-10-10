import { ComingSoon } from "@/components/ComingSoon";
import { requireAdmin } from "@/lib/session";

export default async function Page() {
  await requireAdmin();

  return (
    <ComingSoon
      title="Catalog"
      intro="Tracks and albums, grouped by artist and status."
      items={[
        "Draft, in review, published and archived content per artist",
        "Audio files, splits and rights per track",
        "Publish or archive, one at a time or in bulk",
      ]}
    />
  );
}
