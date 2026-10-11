import Link from "next/link";
import { AnalyticsHeader, AnalyticsNotice } from "@/components/AnalyticsHeader";
import { ShareBar } from "@/components/ShareBar";
import { StatCard } from "@/components/StatCard";
import { getActiveUsers, getBreakdown, getListeners } from "@/lib/analytics";
import { parseFilters } from "@/lib/analyticsFilters";
import { formatNumber, formatShare } from "@/lib/format";
import type { SearchParams } from "@/lib/query";
import { requireAdmin } from "@/lib/session";

export default async function AnalyticsListenersPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireAdmin();

  const filters = parseFilters(await searchParams);

  const [listeners, active, breakdown] = await Promise.all([getListeners(filters), getActiveUsers(), getBreakdown(filters)]);

  const l = listeners.data;
  const buckets = l
    ? [
        { label: "1 to 4 plays", value: l.plays_1_4 },
        { label: "5 to 19 plays", value: l.plays_5_19 },
        { label: "20 to 99 plays", value: l.plays_20_99 },
        { label: "100 plays or more", value: l.plays_100_plus },
      ]
    : [];
  const bucketMax = Math.max(...buckets.map((bucket) => bucket.value), 1);
  const plans = breakdown.data.filter((row) => row.dimension === "entitlement");
  const planMax = Math.max(...plans.map((row) => row.listeners), 1);

  return (
    <>
      <AnalyticsHeader title="Listeners" active="listeners" path="/analytics/listeners" filters={filters} />
      <AnalyticsNotice results={[listeners, active, breakdown]} />

      <div className="stat-grid">
        <StatCard label="Listeners" value={l ? l.listeners : null} hint="Distinct accounts with a qualified play" />
        <StatCard label="New listeners" value={l ? l.new_listeners : null} hint="First qualified play ever is in this period" />
        <StatCard label="Returning listeners" value={l ? l.returning_listeners : null} hint="Already listening before" />
        <StatCard
          label="Returning share"
          value={l ? l.returning_listeners : null}
          display={l ? formatShare(l.returning_listeners, l.listeners) : undefined}
        />
      </div>

      <h2 className="section-title section-gap">Activity</h2>
      <div className="two-col">
        <section className="dash-card">
          <h3 className="subsection-title">How much each listener plays in this period</h3>
          {buckets.length === 0 ? (
            <p className="muted">No data.</p>
          ) : (
            <table className="table">
              <tbody>
                {buckets.map((bucket) => (
                  <tr key={bucket.label}>
                    <td>{bucket.label}</td>
                    <td style={{ width: "34%" }}>
                      <ShareBar value={bucket.value} max={bucketMax} />
                    </td>
                    <td className="num">{formatNumber(bucket.value)}</td>
                    <td className="num muted">{l ? formatShare(bucket.value, l.listeners) : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="dash-card">
          <h3 className="subsection-title">Listening plan</h3>
          {plans.length === 0 ? (
            <p className="muted">No data.</p>
          ) : (
            <table className="table">
              <tbody>
                {plans.map((row) => (
                  <tr key={row.key}>
                    <td>{row.key.replace(/_/g, " ")}</td>
                    <td style={{ width: "34%" }}>
                      <ShareBar value={row.listeners} max={planMax} />
                    </td>
                    <td className="num">{formatNumber(row.listeners)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="muted" style={{ marginTop: "var(--space-xs)" }}>
            During the beta every play is &quot;beta&quot;. Paying and free listeners separate once the app goes live.
          </p>
        </section>
      </div>

      <h2 className="section-title section-gap">Active listeners</h2>
      <div className="stat-grid">
        <StatCard label="Today (24 h)" value={active.data?.dau ?? null} />
        <StatCard label="Last 7 days" value={active.data?.wau ?? null} />
        <StatCard label="Last 30 days" value={active.data?.mau ?? null} />
        <StatCard
          label="Stickiness"
          value={active.data ? active.data.dau : null}
          display={active.data ? formatShare(active.data.dau, active.data.mau) : undefined}
          hint="Daily over monthly"
        />
      </div>
      <p className="muted">Whole platform, as of now: the period and filters above do not apply to these four.</p>

      <p className="muted section-gap">
        These are aggregated figures: nobody is identified here. To see what one account listens to, open it from{" "}
        <Link href="/users" className="text-link">
          Users
        </Link>
        {" "}(each access to a listening history is logged).
      </p>
    </>
  );
}
