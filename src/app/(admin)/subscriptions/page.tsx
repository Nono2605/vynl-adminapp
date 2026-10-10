import Link from "next/link";
import { FilterPills } from "@/components/FilterPills";
import { Notice } from "@/components/Notice";
import { PageHead } from "@/components/PageHead";
import { Pager } from "@/components/Pager";
import { StatCard } from "@/components/StatCard";
import { StatusBadge } from "@/components/StatusBadge";
import { formatDate, formatNumber } from "@/lib/format";
import { first, oneOf, pageRange, parsePage, pick, type SearchParams } from "@/lib/query";
import { requireAdmin } from "@/lib/session";
import { getSubscriptionBreakdown } from "@/lib/subscription";
import { supabaseAdmin } from "@/lib/supabase/admin";

const STATUSES = ["active", "trialing", "past_due", "canceled", "expired"] as const;

interface SubscriptionRow {
  id: string;
  plan: string;
  status: string;
  provider: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  created_at: string;
  user_id: string | null;
  users: { email: string } | { email: string }[] | null;
}

export default async function SubscriptionsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireAdmin();

  const params = await searchParams;
  const status = oneOf(pick(params, "status"), STATUSES);
  const page = parsePage(params);
  const [from, to] = pageRange(page);

  const db = supabaseAdmin();
  const head = { count: "exact", head: true } as const;

  let query = db
    .from("subscriptions")
    .select(
      "id, plan, status, provider, current_period_end, cancel_at_period_end, created_at, user_id, users(email)",
      { count: "exact" }
    )
    .order("created_at", { ascending: false })
    .range(from, to);
  if (status) query = query.eq("status", status);

  const [breakdown, list, all, ...perStatus] = await Promise.all([
    getSubscriptionBreakdown(),
    query,
    db.from("subscriptions").select("id", head),
    ...STATUSES.map((value) => db.from("subscriptions").select("id", head).eq("status", value)),
  ]);

  const rows = (list.data ?? []) as unknown as SubscriptionRow[];
  const subs = breakdown.error ? null : breakdown;
  const plans = Object.entries(breakdown.paidByPlan).sort((a, b) => b[1] - a[1]);

  return (
    <>
      <PageHead title="Subscriptions" />

      {breakdown.error && <Notice>Could not compute the user breakdown: {breakdown.error}</Notice>}

      <div className="stat-grid">
        <StatCard label="Paying" value={subs ? subs.paying : null} hint="Active, within its period" />
        <StatCard label="On trial" value={subs ? subs.trial : null} />
        <StatCard label="Payment past due" value={subs ? subs.pastDue : null} warn />
        <StatCard label="Free" value={subs ? subs.free : null} hint={subs ? `of ${formatNumber(subs.totalUsers)} users` : undefined} />
      </div>
      {subs?.truncated && <p className="muted">These figures are a minimum: the 5,000-row read limit was reached.</p>}

      {plans.length > 0 && (
        <section className="dash-card section-gap">
          <h2 className="section-title">Paying users by plan</h2>
          <dl className="kv">
            {plans.map(([plan, count]) => (
              <div key={plan} style={{ display: "contents" }}>
                <dt>{plan}</dt>
                <dd>{formatNumber(count)}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      <h2 className="section-title section-gap">All subscriptions</h2>
      <FilterPills
        basePath="/subscriptions"
        param="status"
        current={status ?? ""}
        params={{}}
        options={[
          { label: "All", value: "", count: all.error ? null : all.count },
          ...STATUSES.map((value, index) => ({
            label: value.replace("_", " "),
            value,
            count: perStatus[index].error ? null : perStatus[index].count,
          })),
        ]}
      />

      {list.error && <Notice>Could not load subscriptions: {list.error.message}</Notice>}

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>User</th>
              <th>Plan</th>
              <th>Status</th>
              <th>Provider</th>
              <th>Period ends</th>
              <th>Cancels at end</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="empty">
                  No subscriptions yet.
                </td>
              </tr>
            )}
            {rows.map((sub) => {
              const email = first(sub.users)?.email;
              return (
                <tr key={sub.id}>
                  <td className="cell-main">
                    {sub.user_id ? (
                      <Link href={`/users/${sub.user_id}`} className="text-link">
                        {email ?? sub.user_id}
                      </Link>
                    ) : (
                      <span className="muted">Deleted account</span>
                    )}
                  </td>
                  <td>{sub.plan}</td>
                  <td>
                    <StatusBadge status={sub.status} />
                  </td>
                  <td>{sub.provider ?? "—"}</td>
                  <td>{formatDate(sub.current_period_end)}</td>
                  <td>{sub.cancel_at_period_end ? "Yes" : "No"}</td>
                  <td>{formatDate(sub.created_at)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Pager basePath="/subscriptions" params={{ status }} page={page} total={list.count ?? 0} />

      <p className="muted section-gap">Prices, MRR and invoices arrive with the Stripe connection: the database does not store them.</p>
    </>
  );
}
