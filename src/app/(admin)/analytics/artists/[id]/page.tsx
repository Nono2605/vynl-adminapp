import Link from "next/link";
import { notFound } from "next/navigation";
import { AnalyticsHeader, AnalyticsNotice } from "@/components/AnalyticsHeader";
import { DailyBars } from "@/components/DailyBars";
import { ShareBar } from "@/components/ShareBar";
import { StatCard } from "@/components/StatCard";
import {
  filterParams,
  getBreakdown,
  getByCountry,
  getDaily,
  getListeners,
  getTopTracks,
  getTotals,
  type BreakdownRow,
} from "@/lib/analytics";
import { parseFilters } from "@/lib/analyticsFilters";
import { formatListening, formatNumber, formatShare } from "@/lib/format";
import { countryName, regionOf } from "@/lib/geo";
import { isUuid, withParams, type SearchParams } from "@/lib/query";
import { requireAdmin } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase/admin";

const DIMENSIONS: { id: string; label: string }[] = [
  { id: "device", label: "Devices" },
  { id: "source", label: "Where the play started" },
  { id: "entitlement", label: "Listening plan" },
];

function BreakdownTable({ title, rows, total }: { title: string; rows: BreakdownRow[]; total: number }) {
  const max = Math.max(...rows.map((row) => row.plays), 1);
  return (
    <section className="dash-card">
      <h2 className="section-title">{title}</h2>
      {rows.length === 0 ? (
        <p className="muted">No data.</p>
      ) : (
        <table className="table">
          <tbody>
            {rows.map((row) => (
              <tr key={row.key}>
                <td className="cell-main">{row.key.replace(/_/g, " ")}</td>
                <td style={{ width: "28%" }}>
                  <ShareBar value={row.plays} max={max} />
                </td>
                <td className="num">{formatNumber(row.plays)}</td>
                <td className="num muted">{formatShare(row.plays, total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

export default async function AnalyticsArtistPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  await requireAdmin();

  const { id } = await params;
  if (!isUuid(id)) notFound();

  const filters = parseFilters(await searchParams);
  const query = filterParams(filters);

  const { data: artist, error } = await supabaseAdmin().from("artists").select("id, name, slug").eq("id", id).maybeSingle();
  if (error) throw new Error(`Could not load the artist: ${error.message}`);
  if (!artist) notFound();

  const [totals, daily, tracks, countries, breakdown, listeners] = await Promise.all([
    getTotals(filters, id),
    getDaily(filters, id),
    getTopTracks(filters, 10, id),
    getByCountry(filters, id),
    getBreakdown(filters, id),
    getListeners(filters, id),
  ]);

  const t = totals.data;
  const countryRows = countries.data.slice(0, 15);
  const countryMax = Math.max(...countryRows.map((row) => row.plays), 1);
  const byDimension = (dimension: string) => breakdown.data.filter((row) => row.dimension === dimension);
  const l = listeners.data;

  return (
    <>
      <p className="muted">
        <Link href={withParams("/analytics/artists", query)} className="text-link">
          Artists
        </Link>{" "}
        / {artist.name}
      </p>
      <AnalyticsHeader title={artist.name} plain active="artists" path={`/analytics/artists/${id}`} filters={filters} />
      <AnalyticsNotice results={[totals, daily, tracks, countries, breakdown, listeners]} />

      <p style={{ marginBottom: "var(--space-sm)" }}>
        <Link href={`/catalog?artist=${id}`} className="text-link">
          Open in the catalog
        </Link>
      </p>

      <div className="stat-grid">
        <StatCard label="Qualified plays" value={t.plays} hint={`of ${formatNumber(t.starts)} started (${formatShare(t.plays, t.starts)})`} />
        <StatCard label="Listening time" value={t.seconds} display={formatListening(t.seconds)} />
        <StatCard label="Listeners" value={t.listeners} hint="Distinct accounts" />
        <StatCard label="Tracks played" value={t.tracks} />
        <StatCard label="Countries reached" value={t.countries} />
        <StatCard label="New listeners" value={l ? l.new_listeners : null} hint={l ? `${formatNumber(l.returning_listeners)} returning` : undefined} />
      </div>

      <section className="dash-card dash-card--featured section-gap">
        <h2 className="section-title">Plays per day</h2>
        <DailyBars rows={daily.data} />
      </section>

      <div className="two-col section-gap">
        <section className="dash-card">
          <h2 className="section-title">Top tracks</h2>
          {tracks.data.length === 0 ? (
            <p className="muted">No qualified play in this period.</p>
          ) : (
            <table className="table">
              <tbody>
                {tracks.data.map((track, index) => (
                  <tr key={track.track_id}>
                    <td className="num">{index + 1}</td>
                    <td className="cell-main">
                      <Link href={`/catalog/tracks/${track.track_id}`} className="text-link">
                        {track.title}
                      </Link>
                    </td>
                    <td className="num">{formatNumber(track.plays)}</td>
                    <td className="num muted">{formatNumber(track.listeners)} listeners</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="dash-card">
          <h2 className="section-title">Where listeners are</h2>
          {countryRows.length === 0 ? (
            <p className="muted">No qualified play in this period.</p>
          ) : (
            <table className="table">
              <tbody>
                {countryRows.map((row) => (
                  <tr key={row.country}>
                    <td className="cell-main">
                      {countryName(row.country)} <span className="muted">{regionOf(row.country).subregion}</span>
                    </td>
                    <td style={{ width: "26%" }}>
                      <ShareBar value={row.plays} max={countryMax} />
                    </td>
                    <td className="num">{formatNumber(row.plays)}</td>
                    <td className="num muted">{formatShare(row.plays, t.plays)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>

      <div className="two-col section-gap">
        {DIMENSIONS.map((dimension) => (
          <BreakdownTable key={dimension.id} title={dimension.label} rows={byDimension(dimension.id)} total={t.plays} />
        ))}
      </div>

      <p className="muted section-gap">
        Aggregated figures only. To look at one account&apos;s listening, open it from Users (each access is logged).
      </p>
    </>
  );
}
