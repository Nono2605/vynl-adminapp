import { redirect } from "next/navigation";
import { logout } from "@/app/actions/auth";
import { Logo } from "@/components/Logo";
import { getAdmin } from "@/lib/session";
import { LoginForm } from "./LoginForm";

// Pas de requireAdmin() ici (il renvoie vers /login : boucle). On regarde
// l'état : déjà admin -> tableau de bord ; connecté mais pas admin -> message
// et bouton de déconnexion (l'action peut effacer les cookies, pas un Server
// Component) ; anonyme -> formulaire.
export default async function LoginPage() {
  const check = await getAdmin();

  if (check.status === "ok") redirect("/");

  return (
    <div className="bg-signature" style={{ maxWidth: 400, margin: "var(--space-xl) auto", padding: "0 var(--space-md)" }}>
      <div style={{ marginBottom: "var(--space-lg)" }}>
        <Logo />
      </div>
      <h1 className="display-title" style={{ marginBottom: "var(--space-md)" }}>
        Admin
      </h1>
      {check.status === "forbidden" ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
          <p style={{ color: "var(--vynl-erreur)" }}>
            {check.email ? `${check.email} is` : "This account is"} not an active admin account.
          </p>
          <form action={logout}>
            <button type="submit" className="btn btn-secondary">
              Log out
            </button>
          </form>
        </div>
      ) : (
        <LoginForm />
      )}
    </div>
  );
}
