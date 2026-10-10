import { redirect } from "next/navigation";
import { AuthCard } from "@/components/AuthCard";
import { getAdmin } from "@/lib/session";
import { VerifyForm } from "./VerifyForm";

// Pas de requireAdmin() ici (il renvoie vers cette page : boucle). On route
// selon l'état : seul « mfa_verify » reste sur la page.
export default async function MfaVerifyPage() {
  const check = await getAdmin();

  if (check.status === "anonymous" || check.status === "forbidden") redirect("/login");
  if (check.status === "ok") redirect("/");
  if (check.status === "mfa_setup") redirect("/mfa/setup");

  return (
    <AuthCard title="Verify" intro="Enter the 6-digit code from your authenticator app.">
      <VerifyForm />
    </AuthCard>
  );
}
