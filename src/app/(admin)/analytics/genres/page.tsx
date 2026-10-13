import { AnalyticsHeader, AnalyticsNotice } from "@/components/AnalyticsHeader";
import { Notice } from "@/components/Notice";
import { ShareBar } from "@/components/ShareBar";
import { GENRES_MIGRATIONS, getGenres, getTotals } from "@/lib/analytics";
import { parseFilters } from "@/lib/analyticsFilters";
import { formatListening, formatNumber, formatShare } from "@/lib/format";
import type { SearchParams } from "@/lib/query";
import { requireAdmin } from "@/lib/session";

export default async function AnalyticsGenresPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireAdmin();

  const filters = parseFilters(await searchParams);
  const [genres, totals] = await Promise.all([getGenres(filters), getTotals(filters)]);

  const rows = genres.data;
  const total = rows.reduce((sum, row) => sum + row.plays, 0);
  const max = Math.max(...rows.map((row) => row.plays), 1);
  const unclassified = rows.find((row) => row.genre_code === "none");
  const unclassifiedShare = total > 0 && unclassified ? unclassified.plays / total : 0;

  return (
    <>
      <AnalyticsHeader title="Genres" active="genres" path="/analytics/genres" filters={filters} />
      <AnalyticsNotice results={[totals]} />
      {genres.missing ? (
        <Notice>
          The genre figures are not installed yet. Apply <code>{GENRES_MIGRATIONS}</code> in the Supabase SQL editor, in this order,
          then reload.
        </Notice>
      ) : (
        genres.error && <Notice>Could not load the genres: {genres.error}</Notice>
      )}

      <section className="dash-card">
        <h2 className="section-title">What is listened to, by style</h2>
        {rows.length === 0 ? (
          <p className="muted">No qualified play in this period.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Genre</th>
                <th />
                <th className="num">Plays</th>
                <th className="num">Share</th>
                <th className="num">Time</th>
                <th className="num">Listeners</th>
                <th className="num">Tracks</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.genre_code}>
                  <td className="cell-main">{row.label}</td>
                  <td style={{ width: "22%" }}>
                    <ShareBar value={row.plays} max={max} />
                  </td>
                  <td className="num">{formatNumber(row.plays)}</td>
                  <td className="num muted">{formatShare(row.plays, total)}</td>
                  <td className="num">{formatListening(row.seconds)}</td>
                  <td className="num">{formatNumber(row.listeners)}</td>
                  <td className="num">{formatNumber(row.tracks)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="muted" style={{ marginTop: "var(--space-xs)" }}>
          A play is counted when it is qualified (30 seconds listened). Tracks with no genre are grouped under “No genre”
          {unclassifiedShare > 0 ? `: ${formatShare(unclassified!.plays, total)} of the plays in this period` : ""}.
          Genres come from a closed list chosen by the artist.
        </p>
      </section>
    </>
  );
}
