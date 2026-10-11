import { AnalyticsHeader, AnalyticsNotice } from "@/components/AnalyticsHeader";
import { ShareBar } from "@/components/ShareBar";
import { getBreakdown, getTotals, type BreakdownRow } from "@/lib/analytics";
import { parseFilters } from "@/lib/analyticsFilters";
import { formatListening, formatNumber, formatShare } from "@/lib/format";
import type { SearchParams } from "@/lib/query";
import { requireAdmin } from "@/lib/session";

const TABLES: { id: string; title: string; note?: string }[] = [
  { id: "source", title: "Where the play started", note: "Album, playlist, search, discovery, library…" },
  { id: "device", title: "Devices" },
  { id: "entitlement", title: "Listening plan", note: "Every play is “beta” until the app goes live." },
  { id: "app_version", title: "App versions" },
];

function Table({ title, note, rows, total }: { title: string; note?: string; rows: BreakdownRow[]; total: number }) {
  const max = Math.max(...rows.map((row) => row.plays), 1);
  return (
    <section className="dash-card">
      <h2 className="section-title">{title}</h2>
      {rows.length === 0 ? (
        <p className="muted">No data.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th />
              <th />
              <th className="num">Plays</th>
              <th className="num">Share</th>
              <th className="num">Time</th>
              <th className="num">Listeners</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key}>
                <td className="cell-main">{row.key.replace(/_/g, " ")}</td>
                <td style={{ width: "22%" }}>
                  <ShareBar value={row.plays} max={max} />
                </td>
                <td className="num">{formatNumber(row.plays)}</td>
                <td className="num muted">{formatShare(row.plays, total)}</td>
                <td className="num">{formatListening(row.seconds)}</td>
                <td className="num">{formatNumber(row.listeners)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {note && <p className="muted" style={{ marginTop: "var(--space-xs)" }}>{note}</p>}
    </section>
  );
}

export default async function AnalyticsSourcesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireAdmin();

  const filters = parseFilters(await searchParams);
  const [breakdown, totals] = await Promise.all([getBreakdown(filters), getTotals(filters)]);

  const rowsOf = (dimension: string) => breakdown.data.filter((row) => row.dimension === dimension);

  // Heure de la journée (UTC) : les 24 heures sont présentes, à zéro si besoin.
  const byHour = new Map(rowsOf("hour_utc").map((row) => [row.key, row.plays]));
  const hours = Array.from({ length: 24 }, (_, hour) => {
    const key = String(hour).padStart(2, "0");
    return { key, plays: byHour.get(key) ?? 0 };
  });
  const hourMax = Math.max(...hours.map((hour) => hour.plays), 1);

  return (
    <>
      <AnalyticsHeader title="Sources" active="sources" path="/analytics/sources" filters={filters} />
      <AnalyticsNotice results={[breakdown, totals]} />

      <div className="two-col">
        {TABLES.map((table) => (
          <Table key={table.id} title={table.title} note={table.note} rows={rowsOf(table.id)} total={totals.data.plays} />
        ))}
      </div>

      <section className="dash-card section-gap">
        <h2 className="section-title">Time of day (UTC)</h2>
        <div className="bars" role="img" aria-label="Qualified plays by hour of the day, UTC">
          {hours.map((hour) => (
            <div key={hour.key} className="bars__col" title={`${hour.key}:00 UTC: ${formatNumber(hour.plays)} plays`}>
              <div className="bars__bar" style={{ height: `${Math.max((hour.plays / hourMax) * 100, 1)}%` }}>
                <div className="bars__bar-fill" style={{ height: "100%" }} />
              </div>
              <span className="bars__label">{Number(hour.key) % 3 === 0 ? hour.key : " "}</span>
            </div>
          ))}
        </div>
        <p className="muted" style={{ marginTop: "var(--space-xs)" }}>
          Hours are UTC, not the listeners&apos; local time. Switzerland is UTC+1 or +2.
        </p>
      </section>
    </>
  );
}
