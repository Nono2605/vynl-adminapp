import { ComingSoon } from "@/components/ComingSoon";
import { requireAdmin } from "@/lib/session";

export default async function Page() {
  await requireAdmin();

  return (
    <ComingSoon
      title="Audit log"
      intro="A record of every action taken in this admin."
      items={[
        "Who did what, to which record, and when",
        "Before and after values for every change",
      ]}
    />
  );
}
