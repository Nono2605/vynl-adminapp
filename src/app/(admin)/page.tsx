import { Notice } from "@/components/Notice";
import { PageHead } from "@/components/PageHead";
import { StatCard } from "@/components/StatCard";
import { requireAdmin } from "@/lib/session";
import { daysAgo } from "@/lib/time";
import { getSubscriptionBreakdown } from "@/lib/subscription";
import { supabaseAdmin } from "@/lib/supabase/admin";

// Chiffres lus en direct dans la base (comptages exacts, sans rapatrier les
// lignes). Un chiffre dont la requête échoue s'affiche « — » avec un
// avertissement, jamais 0. Les graphiques et le détail sont dans les pages
// dédiées.
export default async function OverviewPage() {
  await requireAdmin();

  const db = supabaseAdmin();
  const head = { count: "exact", head: true } as const;
  const since7Days = daysAgo(7).toISOString();

  const [creators, published, inReview, plays7d, openFraud, subscriptions] = await Promise.all([
    db.from("users").select("id", head).eq("role", "creator"),
    db.from("tracks").select("id", head).eq("status", "published"),
    db.from("tracks").select("id", head).eq("status", "in_review"),
    db.from("plays").select("id", head).eq("counted", true).gte("started_at", since7Days),
    db.from("fraud_events").select("id", head).eq("resolved", false),
    getSubscriptionBreakdown(),
  ]);

  const count = (result: { count: number | null; error: { message: string } | null }) =>
    result.error ? null : result.count;
  const errors = [creators, published, inReview, plays7d, openFraud]
    .map((result) => result.error?.message)
    .concat(subscriptions.error)
    .filter(Boolean);

  const subs = subscriptions.error ? null : subscriptions;

  return (
    <>
      <PageHead title="Overview" />

      {errors.length > 0 && <Notice>Some figures could not be loaded: {errors[0]}</Notice>}

      <h2 className="section-title">Users</h2>
      <div className="stat-grid">
        <StatCard label="Users" value={subs ? subs.totalUsers : null} />
        <StatCard label="Paying" value={subs ? subs.paying : null} />
        <StatCard label="On trial" value={subs ? subs.trial : null} />
        <StatCard label="Free" value={subs ? subs.free : null} hint="No active subscription" />
        <StatCard label="Payment past due" value={subs ? subs.pastDue : null} warn />
      </div>
      {subs?.truncated && <p className="muted">Subscription figures are a minimum: the 5,000-row read limit was reached.</p>}

      <h2 className="section-title section-gap">Catalog</h2>
      <div className="stat-grid">
        <StatCard label="Creators" value={count(creators)} />
        <StatCard label="Published tracks" value={count(published)} />
        <StatCard label="Tracks in review" value={count(inReview)} warn />
      </div>

      <h2 className="section-title section-gap">Listening</h2>
      <div className="stat-grid">
        <StatCard label="Plays, last 7 days" value={count(plays7d)} hint="Counted plays only" />
        <StatCard label="Open fraud events" value={count(openFraud)} warn />
      </div>

      <section className="dash-card coming-soon section-gap">
        <span className="status status--soon">Coming</span>
        <p>Revenue and payouts land here once Stripe is connected.</p>
      </section>
    </>
  );
}
