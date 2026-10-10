import { redirect } from "next/navigation";
import { AuthCard } from "@/components/AuthCard";
import { getAdmin } from "@/lib/session";
import { MfaSetup } from "./MfaSetup";

// Pas de requireAdmin() ici (il renvoie vers cette page : boucle). On route
// selon l'état : seul « mfa_setup » reste sur la page.
export default async function MfaSetupPage() {
  const check = await getAdmin();

  if (check.status === "anonymous" || check.status === "forbidden") redirect("/login");
  if (check.status === "ok") redirect("/");
  if (check.status === "mfa_verify") redirect("/mfa/verify");

  return (
    <AuthCard
      title="Secure your account"
      intro="The admin requires a second step at every login. Set up an authenticator app to continue."
    >
      <MfaSetup />
    </AuthCard>
  );
}
