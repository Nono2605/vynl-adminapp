import Link from "next/link";
import { AnalyticsHeader, AnalyticsNotice } from "@/components/AnalyticsHeader";
import { ShareBar } from "@/components/ShareBar";
import { filterParams, getByCountry, getTotals, type Totals } from "@/lib/analytics";
import { parseFilters } from "@/lib/analyticsFilters";
import { formatListening, formatNumber, formatShare } from "@/lib/format";
import { countriesInRegion, countryName, regionOf } from "@/lib/geo";
import { withParams, type SearchParams } from "@/lib/query";
import { requireAdmin } from "@/lib/session";

// Les marchés de Vynl (UE, Suisse) puis les continents. Ils se recoupent (la Suisse est
// en Europe) : ce sont des angles de lecture, pas une partition.
const GROUPS = [
  { id: "eu", label: "European Union" },
  { id: "ch", label: "Switzerland" },
  { id: "europe", label: "Europe" },
  { id: "americas", label: "Americas" },
  { id: "asia", label: "Asia" },
  { id: "africa", label: "Africa" },
  { id: "oceania", label: "Oceania" },
];

export default async function AnalyticsGeographyPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireAdmin();

  const filters = parseFilters(await searchParams);
  const params = filterParams(filters);

  const countries = await getByCountry(filters);

  // Auditeurs distincts par région : on ne peut pas additionner ceux des pays (un
  // auditeur peut voyager), donc un appel par région, limité aux pays du filtre actif.
  const regions = await Promise.all(
    GROUPS.map(async (group) => {
      const all = countriesInRegion(group.id) ?? [];
      const scoped = filters.countries ? all.filter((code) => filters.countries!.includes(code)) : all;
      if (scoped.length === 0) return { ...group, totals: null as Totals | null, error: undefined as string | undefined };
      const result = await getTotals({ ...filters, countries: scoped });
      return { ...group, totals: result.data, error: result.error };
    })
  );

  const known = countries.data.filter((row) => row.country !== "unknown");
  const unknown = countries.data.find((row) => row.country === "unknown");
  const totalPlays = countries.data.reduce((sum, row) => sum + row.plays, 0);
  const regionMax = Math.max(...regions.map((region) => region.totals?.plays ?? 0), 1);
  const countryMax = Math.max(...known.map((row) => row.plays), 1);

  // Sous-régions : plays et temps d'écoute se somment, pas les auditeurs.
  const subregions = new Map<string, { plays: number; seconds: number; countries: number }>();
  for (const row of known) {
    const key = regionOf(row.country).subregion;
    const entry = subregions.get(key) ?? { plays: 0, seconds: 0, countries: 0 };
    entry.plays += row.plays;
    entry.seconds += row.seconds;
    entry.countries += 1;
    subregions.set(key, entry);
  }
  const subregionRows = [...subregions.entries()].sort((a, b) => b[1].plays - a[1].plays);

  return (
    <>
      <AnalyticsHeader title="Geography" active="geography" path="/analytics/geography" filters={filters} />
      <AnalyticsNotice results={[countries]} />

      <div className="page-head" style={{ marginBottom: "var(--space-xs)" }}>
        <h2 className="section-title" style={{ marginBottom: 0 }}>
          Markets and continents
        </h2>
        <Link href={withParams("/analytics/export", { ...params, view: "countries" })} className="btn btn-secondary btn-sm" prefetch={false}>
          Export CSV
        </Link>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Region</th>
              <th className="num">Plays</th>
              <th style={{ width: "22%" }}>Share of plays</th>
              <th className="num">Listening time</th>
              <th className="num">Listeners</th>
              <th className="num">Countries</th>
            </tr>
          </thead>
          <tbody>
            {regions.map((region) => (
              <tr key={region.id}>
                <td>{region.label}</td>
                <td className="num">{region.totals ? formatNumber(region.totals.plays) : "—"}</td>
                <td>
                  <ShareBar value={region.totals?.plays ?? 0} max={regionMax} />
                  <span className="muted"> {region.totals ? formatShare(region.totals.plays, totalPlays) : ""}</span>
                </td>
                <td className="num">{region.totals ? formatListening(region.totals.seconds) : "—"}</td>
                <td className="num">{region.totals ? formatNumber(region.totals.listeners) : "—"}</td>
                <td className="num">{region.totals ? formatNumber(region.totals.countries) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted">
        Markets and continents overlap (Switzerland is in Europe), so the shares do not add up to 100%. Each row counts distinct
        listeners on its own.
      </p>

      <h2 className="section-title section-gap">Subregions</h2>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Subregion</th>
              <th className="num">Plays</th>
              <th style={{ width: "22%" }}>Share of plays</th>
              <th className="num">Listening time</th>
              <th className="num">Countries</th>
            </tr>
          </thead>
          <tbody>
            {subregionRows.length === 0 && (
              <tr>
                <td colSpan={5} className="empty">
                  No qualified play with a known country in this period.
                </td>
              </tr>
            )}
            {subregionRows.map(([name, row]) => (
              <tr key={name}>
                <td>{name}</td>
                <td className="num">{formatNumber(row.plays)}</td>
                <td>
                  <ShareBar value={row.plays} max={subregionRows[0][1].plays} />
                  <span className="muted"> {formatShare(row.plays, totalPlays)}</span>
                </td>
                <td className="num">{formatListening(row.seconds)}</td>
                <td className="num">{formatNumber(row.countries)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="section-title section-gap">Countries</h2>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th className="num">#</th>
              <th>Country</th>
              <th>Region</th>
              <th className="num">Plays</th>
              <th style={{ width: "18%" }}>Share of plays</th>
              <th className="num">Listening time</th>
              <th className="num">Listeners</th>
              <th className="num">Started</th>
            </tr>
          </thead>
          <tbody>
            {known.length === 0 && (
              <tr>
                <td colSpan={8} className="empty">
                  No qualified play with a known country in this period.
                </td>
              </tr>
            )}
            {known.map((row, index) => (
              <tr key={row.country}>
                <td className="num">{index + 1}</td>
                <td className="cell-main">
                  {countryName(row.country)} <span className="muted">{row.country}</span>
                </td>
                <td className="muted">{regionOf(row.country).subregion}</td>
                <td className="num">{formatNumber(row.plays)}</td>
                <td>
                  <ShareBar value={row.plays} max={countryMax} />
                  <span className="muted"> {formatShare(row.plays, totalPlays)}</span>
                </td>
                <td className="num">{formatListening(row.seconds)}</td>
                <td className="num">{formatNumber(row.listeners)}</td>
                <td className="num">{formatNumber(row.starts)}</td>
              </tr>
            ))}
            {unknown && (
              <tr>
                <td className="num">—</td>
                <td className="cell-main">Country not determined</td>
                <td className="muted">—</td>
                <td className="num">{formatNumber(unknown.plays)}</td>
                <td>
                  <span className="muted">{formatShare(unknown.plays, totalPlays)}</span>
                </td>
                <td className="num">{formatListening(unknown.seconds)}</td>
                <td className="num">{formatNumber(unknown.listeners)}</td>
                <td className="num">{formatNumber(unknown.starts)}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="muted section-gap">
        The country is derived from the visitor&apos;s IP address (the address is not stored) and is not verified. Plays older than
        the country tracking, or from a visitor whose country could not be read, are under &quot;not determined&quot;.
      </p>
    </>
  );
}
