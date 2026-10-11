import Link from "next/link";
import { AnalyticsHeader, AnalyticsNotice } from "@/components/AnalyticsHeader";
import { DailyBars } from "@/components/DailyBars";
import { Notice } from "@/components/Notice";
import { ShareBar } from "@/components/ShareBar";
import { StatCard } from "@/components/StatCard";
import {
  getActiveUsers,
  getByCountry,
  getDaily,
  filterParams,
  getDataQuality,
  getTopArtists,
  getTotals,
} from "@/lib/analytics";
import { parseFilters } from "@/lib/analyticsFilters";
import { formatListening, formatNumber, formatShare } from "@/lib/format";
import { countryName, regionOf } from "@/lib/geo";
import { withParams, type SearchParams } from "@/lib/query";
import { requireAdmin } from "@/lib/session";

export default async function AnalyticsOverviewPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireAdmin();

  const filters = parseFilters(await searchParams);
  const params = filterParams(filters);

  const [totals, daily, artists, countries, active, quality] = await Promise.all([
    getTotals(filters),
    getDaily(filters),
    getTopArtists(filters, 5),
    getByCountry(filters),
    getActiveUsers(),
    getDataQuality(filters),
  ]);

  const t = totals.data;
  const topCountries = countries.data.slice(0, 5);
  const countryMax = Math.max(...topCountries.map((row) => row.plays), 1);
  const q = quality.data;
  const countryCoverage = q && q.total ? q.with_country / q.total : null;

  return (
    <>
      <AnalyticsHeader title="Analytics" active="overview" path="/analytics" filters={filters} />
      <AnalyticsNotice results={[totals, daily, artists, countries, active, quality]} />

      <div className="stat-grid">
        <StatCard label="Qualified plays" value={t.plays} hint={`of ${formatNumber(t.starts)} started (${formatShare(t.plays, t.starts)})`} />
        <StatCard label="Listening time" value={t.seconds} display={formatListening(t.seconds)} hint="Qualified plays only" />
        <StatCard label="Listeners" value={t.listeners} hint="Distinct accounts" />
        <StatCard label="Artists played" value={t.artists} />
        <StatCard label="Tracks played" value={t.tracks} />
        <StatCard label="Countries reached" value={t.countries} />
        <StatCard label="Excluded plays" value={t.excluded} warn hint="Not counted (fraud or admin)" />
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
          hint="Daily over monthly listeners"
        />
      </div>
      <p className="muted">Whole platform, as of now: the period and filters above do not apply.</p>

      <section className="dash-card dash-card--featured section-gap">
        <h2 className="section-title">Plays per day</h2>
        <DailyBars rows={daily.data} />
        <p className="muted" style={{ marginTop: "var(--space-xs)" }}>
          Bar height is the plays started and counted; the cyan part is the share that qualified.
        </p>
      </section>

      <div className="two-col section-gap">
        <section className="dash-card">
          <div className="page-head" style={{ marginBottom: "var(--space-xs)" }}>
            <h2 className="section-title" style={{ marginBottom: 0 }}>Top artists</h2>
            <Link href={withParams("/analytics/artists", params)} className="text-link">
              All artists
            </Link>
          </div>
          {artists.data.length === 0 ? (
            <p className="muted">No qualified play in this period.</p>
          ) : (
            <table className="table">
              <tbody>
                {artists.data.map((artist, index) => (
                  <tr key={artist.artist_id}>
                    <td className="num">{index + 1}</td>
                    <td className="cell-main">
                      <Link href={withParams(`/analytics/artists/${artist.artist_id}`, params)} className="text-link">
                        {artist.name}
                      </Link>
                    </td>
                    <td className="num">{formatNumber(artist.plays)} plays</td>
                    <td className="num">{formatNumber(artist.listeners)} listeners</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="dash-card">
          <div className="page-head" style={{ marginBottom: "var(--space-xs)" }}>
            <h2 className="section-title" style={{ marginBottom: 0 }}>Top countries</h2>
            <Link href={withParams("/analytics/geography", params)} className="text-link">
              Geography
            </Link>
          </div>
          {topCountries.length === 0 ? (
            <p className="muted">No qualified play in this period.</p>
          ) : (
            <table className="table">
              <tbody>
                {topCountries.map((row) => (
                  <tr key={row.country}>
                    <td className="cell-main">
                      {countryName(row.country)} <span className="muted">{regionOf(row.country).subregion}</span>
                    </td>
                    <td style={{ width: "30%" }}>
                      <ShareBar value={row.plays} max={countryMax} />
                    </td>
                    <td className="num">{formatNumber(row.plays)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>

      <section className="dash-card section-gap">
        <h2 className="section-title">Data quality</h2>
        {q && q.total > 0 ? (
          <>
            <dl className="kv">
              <dt>Country known</dt>
              <dd>{formatShare(q.with_country, q.total)}</dd>
              <dt>Device known</dt>
              <dd>{formatShare(q.with_device, q.total)}</dd>
              <dt>IP fingerprint</dt>
              <dd>{formatShare(q.with_ip_hash, q.total)}</dd>
              <dt>Source known</dt>
              <dd>{formatShare(q.with_source, q.total)}</dd>
              <dt>Counted plays</dt>
              <dd>{formatNumber(q.total)}</dd>
            </dl>
            {countryCoverage !== null && countryCoverage < 0.9 && (
              <Notice>
                The country is missing on {formatShare(q.total - q.with_country, q.total)} of plays, so geography is incomplete.
                Check that the listener app forwards the country header and that the API has <code>IP_HASH_SECRET</code> set.
              </Notice>
            )}
          </>
        ) : (
          <p className="muted">No counted play in this period.</p>
        )}
        <p className="muted" style={{ marginTop: "var(--space-xs)" }}>
          The country comes from the visitor&apos;s IP address as seen by the listener app. The address itself is never stored, and
          the country is not verified: fine for statistics, not yet for ad revenue by country.
        </p>
      </section>
    </>
  );
}
