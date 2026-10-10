import { requireAdmin } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase/admin";

interface Stat {
  label: string;
  value: number | null;
  warn?: boolean;
}

// Premiers chiffres, tous lus en direct dans la base (comptages exacts, sans
// rapatrier les lignes). Ils servent aussi de test de bout en bout : si la
// clé secret ou le rôle admin sont mal réglés, cette page le montre tout de
// suite. Les graphiques et le détail arrivent avec les pages dédiées.
export default async function OverviewPage() {
  await requireAdmin();

  const db = supabaseAdmin();
  const head = { count: "exact", head: true } as const;

  const [users, creators, published, inReview, pendingAi] = await Promise.all([
    db.from("users").select("id", head),
    db.from("users").select("id", head).eq("role", "creator"),
    db.from("tracks").select("id", head).eq("status", "published"),
    db.from("tracks").select("id", head).eq("status", "in_review"),
    db.from("ai_declarations").select("id", head).eq("status", "pending_review"),
  ]);

  const results = [users, creators, published, inReview, pendingAi];
  const hasError = results.some((r) => r.error);

  const stats: Stat[] = [
    { label: "Users", value: users.error ? null : users.count },
    { label: "Creators", value: creators.error ? null : creators.count },
    { label: "Published tracks", value: published.error ? null : published.count },
    { label: "Tracks in review", value: inReview.error ? null : inReview.count, warn: true },
    { label: "AI declarations pending", value: pendingAi.error ? null : pendingAi.count, warn: true },
  ];

  return (
    <>
      <div className="page-head">
        <h1 className="display-title">Overview</h1>
      </div>

      {hasError && (
        <p className="notice" role="alert">
          Some figures could not be loaded: {results.find((r) => r.error)?.error?.message}
        </p>
      )}

      <div className="stat-grid">
        {stats.map((stat) => (
          <section key={stat.label} className="dash-card stat-card">
            <span className="stat-label">{stat.label}</span>
            <span
              className="stat-value"
              style={stat.warn && stat.value ? { color: "var(--vynl-alerte)" } : undefined}
            >
              {stat.value === null ? "—" : stat.value.toLocaleString("en-US")}
            </span>
          </section>
        ))}
      </div>

      <section className="dash-card coming-soon" style={{ marginTop: "var(--space-md)" }}>
        <span className="status status--soon">Coming</span>
        <p>Paying vs free users, plays per day, revenue and payouts land here as their pages are built.</p>
      </section>
    </>
  );
}
