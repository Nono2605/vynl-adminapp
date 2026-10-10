import { ComingSoon } from "@/components/ComingSoon";
import { requireAdmin } from "@/lib/session";

export default async function Page() {
  await requireAdmin();

  return (
    <ComingSoon
      title="Users"
      intro="Every account on Vynl, with the tools to manage them."
      items={[
        "List filtered by role, status, subscription and country",
        "Profile, subscription, library, playlists and recent plays per user",
        "Suspend or reactivate an account (with a reason)",
        "Change role: listener, creator, admin",
        "Send a password reset link, revoke sessions",
      ]}
    />
  );
}
