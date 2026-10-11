import { getByCountry, getDaily, getTopArtists, getTopTracks } from "@/lib/analytics";
import { parseFilters } from "@/lib/analyticsFilters";
import { toCsv } from "@/lib/csv";
import { regionOf, countryName } from "@/lib/geo";
import { oneOf } from "@/lib/query";
import { requireAdmin } from "@/lib/session";

const VIEWS = ["artists", "tracks", "countries", "daily"] as const;
const EXPORT_LIMIT = 200;

// Export CSV des agrégats affichés (mêmes filtres que la page, passés dans l'adresse).
// Aucune ligne ne désigne un auditeur : ce sont les mêmes chiffres agrégés que l'écran.
export async function GET(request: Request) {
  await requireAdmin();

  const params = Object.fromEntries(new URL(request.url).searchParams);
  const view = oneOf(params.view ?? "", VIEWS);
  if (!view) return new Response("Unknown export", { status: 400 });

  const filters = parseFilters(params);

  let headers: string[] = [];
  let rows: unknown[][] = [];
  let error: string | undefined;

  if (view === "artists") {
    const result = await getTopArtists(filters, EXPORT_LIMIT);
    error = result.error;
    headers = ["artist_id", "artist", "qualified_plays", "listening_seconds", "listeners", "countries"];
    rows = result.data.map((row) => [row.artist_id, row.name, row.plays, row.seconds, row.listeners, row.countries]);
  } else if (view === "tracks") {
    const result = await getTopTracks(filters, EXPORT_LIMIT);
    error = result.error;
    headers = ["track_id", "track", "artist_id", "artist", "qualified_plays", "listening_seconds", "listeners"];
    rows = result.data.map((row) => [row.track_id, row.title, row.artist_id, row.artist_name, row.plays, row.seconds, row.listeners]);
  } else if (view === "countries") {
    const result = await getByCountry(filters);
    error = result.error;
    headers = ["country_code", "country", "continent", "subregion", "qualified_plays", "started_plays", "listening_seconds", "listeners"];
    rows = result.data.map((row) => [
      row.country,
      countryName(row.country),
      regionOf(row.country).continent,
      regionOf(row.country).subregion,
      row.plays,
      row.starts,
      row.seconds,
      row.listeners,
    ]);
  } else {
    const result = await getDaily(filters);
    error = result.error;
    headers = ["day_utc", "started_plays", "qualified_plays", "listeners", "listening_seconds"];
    rows = result.data.map((row) => [row.day, row.starts, row.plays, row.listeners, row.seconds]);
  }

  if (error) return new Response(`Could not build the export: ${error}`, { status: 500 });

  const lastDay = new Date(filters.to.getTime() - 24 * 3600 * 1000).toISOString().slice(0, 10);
  const filename = `vynl-${view}-${filters.from.toISOString().slice(0, 10)}_${lastDay}.csv`;

  return new Response(toCsv(headers, rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
