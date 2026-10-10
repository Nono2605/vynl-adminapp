import { logout } from "@/app/actions/auth";
import { Logo } from "@/components/Logo";

// Page d'authentification centrée (même gabarit que /login), avec un bouton de
// déconnexion : sur les pages MFA l'admin est déjà connecté par mot de passe
// et doit pouvoir changer de compte.
export function AuthCard({
  title,
  intro,
  children,
}: {
  title: string;
  intro?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-signature" style={{ maxWidth: 400, margin: "var(--space-xl) auto", padding: "0 var(--space-md)" }}>
      <div style={{ marginBottom: "var(--space-lg)" }}>
        <Logo />
      </div>
      <h1 className="display-title" style={{ marginBottom: "var(--space-sm)" }}>
        {title}
      </h1>
      {intro && <p style={{ color: "var(--vynl-texte-2)", marginBottom: "var(--space-md)" }}>{intro}</p>}
      {children}
      <form action={logout} style={{ marginTop: "var(--space-md)" }}>
        <button type="submit" className="btn-plain text-link">
          Log out
        </button>
      </form>
    </div>
  );
}
