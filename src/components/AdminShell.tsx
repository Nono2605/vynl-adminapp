import { logout } from "@/app/actions/auth";
import { Logo } from "@/components/Logo";
import { Sidebar } from "@/components/Sidebar";

// Coque visuelle seule (navigation + en-tête). La vérification du rôle admin
// est faite par (admin)/layout.tsx avant de l'afficher : ce composant ne
// décide de rien.
export function AdminShell({ email, children }: { email: string; children: React.ReactNode }) {
  return (
    <div className="shell">
      <Sidebar />
      <div className="shell__main">
        <header className="shell__header">
          <span className="shell__brand-mobile">
            <Logo />
          </span>
          <span className="shell__artist">
            <span className="avatar" aria-hidden="true" />
            <strong>{email}</strong>
          </span>
          <form action={logout}>
            <button type="submit" className="btn btn-secondary btn-sm">
              Log out
            </button>
          </form>
        </header>
        <main className="shell__content">{children}</main>
      </div>
    </div>
  );
}
