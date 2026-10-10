import { AdminShell } from "@/components/AdminShell";
import { requireAdmin } from "@/lib/session";

// Tout ce qui est sous (admin)/ passe par ici. Mais un layout n'est pas
// ré-exécuté quand on navigue entre deux pages qui le partagent : chaque page
// qui lit des données et chaque Server Action doit AUSSI appeler requireAdmin().
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await requireAdmin();

  return <AdminShell email={admin.email}>{children}</AdminShell>;
}
