import Link from "next/link";
import { FilterPills } from "@/components/FilterPills";
import { Notice } from "@/components/Notice";
import { PageHead } from "@/components/PageHead";
import { Pager } from "@/components/Pager";
import { StatCard } from "@/components/StatCard";
import { StatusBadge } from "@/components/StatusBadge";
import { formatDay, formatDateTime, formatDuration, formatNumber } from "@/lib/format";
import { first, oneOf, pageRange, parsePage, pick, type SearchParams } from "@/lib/query";
import { requireAdmin } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { daysAgo, hoursAgo, startOfUtcDay } from "@/lib/time";

const SHOW = ["qualified", "excluded"] as const;
const CHART_DAYS = 14;

interface PlayRow {
  id: string;
  user_id: string | null;
  started_at: string;
  validated_seconds: number;
  track_duration_seconds: number | null;
  qualified: boolean;
  counted: boolean;
  excluded_reason: string | null;
  entitlement: string;
  device_type: string | null;
  country_code: string | null;
  tracks: { title: string } | { title: string }[] | null;
  artists: { name: string } | { name: string }[] | null;
  users: { email: string } | { email: string }[] | null;
}

export default async function PlaysPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireAdmin();

  const params = await searchParams;
  const show = oneOf(pick(params, "show"), SHOW);
  const page = parsePage(params);
  const [from, to] = pageRange(page);

  const db = supabaseAdmin();
  const head = { count: "exact", head: true } as const;
  const since24h = hoursAgo(24).toISOString();
  const since7d = daysAgo(7).toISOString();
  const since30d = daysAgo(30).toISOString();

  // Une « écoute comptée » (counted) est une écoute retenue ; « qualifiée »
  // (qualified) a de plus atteint le seuil de qualification. Les autres sont
  // exclues, avec une raison.
  const countedSince = (since: string) =>
    db.from("plays").select("id", head).eq("counted", true).gte("started_at", since);

  // Histogramme : 2 comptages exacts par jour (pas de GROUP BY sans fonction SQL).
  const days = Array.from({ length: CHART_DAYS }, (_, index) => {
    const start = startOfUtcDay(CHART_DAYS - 1 - index);
    const end = new Date(start.getTime() + 24 * 3600 * 1000);
    return { start, end };
  });
  const dayCounts = days.map(({ start, end }) =>
    Promise.all([
      db
        .from("plays")
        .select("id", head)
        .eq("counted", true)
        .gte("started_at", start.toISOString())
        .lt("started_at", end.toISOString()),
      db
        .from("plays")
        .select("id", head)
        .eq("counted", true)
        .eq("qualified", true)
        .gte("started_at", start.toISOString())
        .lt("started_at", end.toISOString()),
    ])
  );

  let listQuery = db
    .from("plays")
    .select(
      "id, user_id, started_at, validated_seconds, track_duration_seconds, qualified, counted, excluded_reason, entitlement, device_type, country_code, tracks(title), artists(name), users(email)",
      { count: "exact" }
    )
    .order("started_at", { ascending: false })
    .range(from, to);
  if (show === "qualified") listQuery = listQuery.eq("counted", true).eq("qualified", true);
  if (show === "excluded") listQuery = listQuery.eq("counted", false);

  const [all, last24h, last7d, last30d, qualified7d, excluded7d, list, perDay] = await Promise.all([
    db.from("plays").select("id", head),
    countedSince(since24h),
    countedSince(since7d),
    countedSince(since30d),
    db.from("plays").select("id", head).eq("counted", true).eq("qualified", true).gte("started_at", since7d),
    db.from("plays").select("id", head).eq("counted", false).gte("started_at", since7d),
    listQuery,
    Promise.all(dayCounts),
  ]);

  const count = (result: { count: number | null; error: { message: string } | null }) =>
    result.error ? null : result.count;

  const series = days.map(({ start }, index) => ({
    label: formatDay(start),
    counted: perDay[index][0].error ? 0 : (perDay[index][0].count ?? 0),
    qualified: perDay[index][1].error ? 0 : (perDay[index][1].count ?? 0),
  }));
  const chartError = perDay.flat().find((result) => result.error)?.error?.message;
  const max = Math.max(...series.map((day) => day.counted), 1);

  const rows = (list.data ?? []) as unknown as PlayRow[];

  return (
    <>
      <PageHead title="Plays" />

      <div className="stat-grid">
        <StatCard label="Plays, last 24 hours" value={count(last24h)} hint="Counted plays" />
        <StatCard label="Plays, last 7 days" value={count(last7d)} hint="Counted plays" />
        <StatCard label="Plays, last 30 days" value={count(last30d)} hint="Counted plays" />
        <StatCard label="Qualified, last 7 days" value={count(qualified7d)} />
        <StatCard label="Excluded, last 7 days" value={count(excluded7d)} warn />
        <StatCard label="All plays, ever" value={count(all)} hint="Counted or not" />
      </div>

      <section className="dash-card dash-card--featured section-gap">
        <h2 className="section-title">Counted plays per day, last {CHART_DAYS} days (UTC)</h2>
        {chartError && <Notice>Some days could not be loaded: {chartError}</Notice>}
        <div className="bars" role="img" aria-label={`Counted plays per day over the last ${CHART_DAYS} days`}>
          {series.map((day) => (
            <div key={day.label} className="bars__col" title={`${day.label}: ${day.counted} counted, ${day.qualified} qualified`}>
              <span className="bars__value">{formatNumber(day.counted)}</span>
              <div className="bars__bar" style={{ height: `${Math.max((day.counted / max) * 100, 1)}%` }}>
                <div
                  className="bars__bar-fill"
                  style={{ height: day.counted ? `${(day.qualified / day.counted) * 100}%` : 0 }}
                />
              </div>
              <span className="bars__label">{day.label}</span>
            </div>
          ))}
        </div>
        <p className="muted" style={{ marginTop: "var(--space-xs)" }}>
          The cyan part of each bar is the share that qualified.
        </p>
      </section>

      <h2 className="section-title section-gap">Latest plays</h2>
      <FilterPills
        basePath="/plays"
        param="show"
        current={show ?? ""}
        params={{}}
        options={[
          { label: "All", value: "" },
          { label: "Qualified", value: "qualified" },
          { label: "Excluded", value: "excluded" },
        ]}
      />

      {list.error && <Notice>Could not load plays: {list.error.message}</Notice>}

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>When</th>
              <th>Listener</th>
              <th>Track</th>
              <th>Artist</th>
              <th className="num">Listened</th>
              <th>Entitlement</th>
              <th>Result</th>
              <th>Country</th>
              <th>Device</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={9} className="empty">
                  No plays yet.
                </td>
              </tr>
            )}
            {rows.map((play) => {
              const email = first(play.users)?.email;
              return (
                <tr key={play.id}>
                  <td>{formatDateTime(play.started_at)}</td>
                  <td className="cell-main">
                    {play.user_id ? (
                      <Link href={`/users/${play.user_id}`} className="text-link">
                        {email ?? play.user_id}
                      </Link>
                    ) : (
                      <span className="muted">Anonymous</span>
                    )}
                  </td>
                  <td className="cell-main">{first(play.tracks)?.title ?? "—"}</td>
                  <td>{first(play.artists)?.name ?? "—"}</td>
                  <td className="num">
                    {formatDuration(play.validated_seconds)}
                    {play.track_duration_seconds ? ` / ${formatDuration(play.track_duration_seconds)}` : ""}
                  </td>
                  <td>{play.entitlement}</td>
                  <td>
                    {play.counted ? (
                      <StatusBadge status={play.qualified ? "approved" : "open"} />
                    ) : (
                      <StatusBadge status="rejected" />
                    )}{" "}
                    <span className="muted">
                      {play.counted ? (play.qualified ? "qualified" : "counted") : (play.excluded_reason ?? "excluded")}
                    </span>
                  </td>
                  <td>{play.country_code ?? "—"}</td>
                  <td>{play.device_type ?? "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Pager basePath="/plays" params={{ show }} page={page} total={list.count ?? 0} />

      <section className="dash-card coming-soon section-gap">
        <span className="status status--soon">Coming</span>
        <p>Top tracks and artists, and breakdowns by country, device and app version. They need aggregation queries.</p>
      </section>
    </>
  );
}
