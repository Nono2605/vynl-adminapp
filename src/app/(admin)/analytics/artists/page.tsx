import Link from "next/link";
import { AnalyticsHeader, AnalyticsNotice } from "@/components/AnalyticsHeader";
import { ShareBar } from "@/components/ShareBar";
import { filterParams, getTopArtists, getTotals } from "@/lib/analytics";
import { parseFilters } from "@/lib/analyticsFilters";
import { formatListening, formatNumber, formatShare } from "@/lib/format";
import { withParams, type SearchParams } from "@/lib/query";
import { requireAdmin } from "@/lib/session";

const LIMIT = 50;

export default async function AnalyticsArtistsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireAdmin();

  const filters = parseFilters(await searchParams);
  const params = filterParams(filters);

  const [artists, totals] = await Promise.all([getTopArtists(filters, LIMIT), getTotals(filters)]);
  const max = Math.max(...artists.data.map((artist) => artist.plays), 1);

  return (
    <>
      <AnalyticsHeader title="Artists" active="artists" path="/analytics/artists" filters={filters} />
      <AnalyticsNotice results={[artists, totals]} />

      <div className="page-head" style={{ marginBottom: "var(--space-xs)" }}>
        <p className="muted" style={{ margin: 0 }}>
          Ranked by qualified plays. Open an artist to see who listens to them and where.
        </p>
        <Link href={withParams("/analytics/export", { ...params, view: "artists" })} className="btn btn-secondary btn-sm" prefetch={false}>
          Export CSV
        </Link>
      </div>

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th className="num">#</th>
              <th>Artist</th>
              <th className="num">Plays</th>
              <th style={{ width: "18%" }}>Share of plays</th>
              <th className="num">Listening time</th>
              <th className="num">Listeners</th>
              <th className="num">Countries</th>
            </tr>
          </thead>
          <tbody>
            {artists.data.length === 0 && (
              <tr>
                <td colSpan={7} className="empty">
                  No qualified play in this period.
                </td>
              </tr>
            )}
            {artists.data.map((artist, index) => (
              <tr key={artist.artist_id}>
                <td className="num">{index + 1}</td>
                <td className="cell-main">
                  <Link href={withParams(`/analytics/artists/${artist.artist_id}`, params)} className="text-link">
                    {artist.name}
                  </Link>
                </td>
                <td className="num">{formatNumber(artist.plays)}</td>
                <td>
                  <ShareBar value={artist.plays} max={max} />
                  <span className="muted"> {formatShare(artist.plays, totals.data.plays)}</span>
                </td>
                <td className="num">{formatListening(artist.seconds)}</td>
                <td className="num">{formatNumber(artist.listeners)}</td>
                <td className="num">{formatNumber(artist.countries)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {artists.data.length === LIMIT && <p className="muted">Showing the top {LIMIT}. Export the CSV for more.</p>}
    </>
  );
}
