import "server-only";
import { filterParams, type AnalyticsFilters } from "@/lib/analyticsFilters";
import { supabaseAdmin } from "@/lib/supabase/admin";

// Accès aux fonctions SQL d'agrégation (supabase/migrations/20261011200000_admin_analytics.sql).
// Toutes renvoient des agrégats ; la clé secret est la seule à pouvoir les appeler.

export const ANALYTICS_MIGRATION = "supabase/migrations/20261011200000_admin_analytics.sql";

export interface Totals {
  starts: number;
  plays: number;
  listeners: number;
  seconds: number;
  artists: number;
  tracks: number;
  countries: number;
  excluded: number;
}
export interface DailyRow {
  day: string;
  starts: number;
  plays: number;
  listeners: number;
  seconds: number;
}
export interface TopArtist {
  artist_id: string;
  name: string;
  plays: number;
  seconds: number;
  listeners: number;
  countries: number;
}
export interface TopTrack {
  track_id: string;
  title: string;
  artist_id: string;
  artist_name: string;
  plays: number;
  seconds: number;
  listeners: number;
}
export interface CountryRow {
  country: string;
  starts: number;
  plays: number;
  seconds: number;
  listeners: number;
}
export interface BreakdownRow {
  dimension: string;
  key: string;
  plays: number;
  seconds: number;
  listeners: number;
}
export interface ListenersRow {
  listeners: number;
  new_listeners: number;
  returning_listeners: number;
  plays_1_4: number;
  plays_5_19: number;
  plays_20_99: number;
  plays_100_plus: number;
}
export interface ActiveUsers {
  dau: number;
  wau: number;
  mau: number;
}
export interface DataQuality {
  total: number;
  with_country: number;
  with_device: number;
  with_ip_hash: number;
  with_source: number;
}
export interface UserArtist {
  artist_id: string;
  name: string;
  plays: number;
  seconds: number;
}

// Résultat d'un appel : jamais d'exception pour une fonction absente (migration pas
// encore appliquée) ni pour une erreur de base : la page affiche l'avertissement et
// le reste continue de s'afficher.
export interface Result<T> {
  data: T;
  error?: string;
  // true : la fonction SQL n'existe pas encore.
  missing?: boolean;
}

async function call<T>(fn: string, args: Record<string, unknown>, empty: T): Promise<Result<T>> {
  const { data, error } = await supabaseAdmin().rpc(fn, args);
  if (error) {
    const missing = error.code === "PGRST202" || /could not find the function/i.test(error.message);
    return { data: empty, error: error.message, missing };
  }
  return { data: (data ?? empty) as T };
}

function args(filters: AnalyticsFilters, extra: Record<string, unknown> = {}) {
  return {
    p_from: filters.from.toISOString(),
    p_to: filters.to.toISOString(),
    p_countries: filters.countries,
    p_device: filters.device || null,
    p_entitlement: filters.plan || null,
    ...extra,
  };
}

const ZERO_TOTALS: Totals = { starts: 0, plays: 0, listeners: 0, seconds: 0, artists: 0, tracks: 0, countries: 0, excluded: 0 };

// artistId : restreint à un artiste (page d'un artiste).
export async function getTotals(filters: AnalyticsFilters, artistId?: string): Promise<Result<Totals>> {
  const result = await call<Totals[]>("admin_stats_totals", args(filters, { p_artist_id: artistId ?? null }), []);
  return { ...result, data: result.data[0] ?? ZERO_TOTALS };
}

export const getDaily = (filters: AnalyticsFilters, artistId?: string) =>
  call<DailyRow[]>("admin_stats_daily", args(filters, { p_artist_id: artistId ?? null }), []);

export const getTopArtists = (filters: AnalyticsFilters, limit = 20) =>
  call<TopArtist[]>("admin_stats_top_artists", args(filters, { p_limit: limit }), []);

export const getTopTracks = (filters: AnalyticsFilters, limit = 20, artistId?: string) =>
  call<TopTrack[]>("admin_stats_top_tracks", args(filters, { p_artist_id: artistId ?? null, p_limit: limit }), []);

// Par genre (supabase/migrations/20261014100000_admin_genres.sql, qui demande d'abord la migration des genres
// de l'API). « none » regroupe les morceaux sans genre.
export const GENRES_MIGRATIONS = "API/supabase/migrations/20261014000002_genres.sql then supabase/migrations/20261014100000_admin_genres.sql";

export interface GenreRow {
  genre_code: string;
  label: string;
  plays: number;
  seconds: number;
  listeners: number;
  tracks: number;
}

export const getGenres = (filters: AnalyticsFilters, artistId?: string) =>
  call<GenreRow[]>("admin_stats_genres", args(filters, { p_artist_id: artistId ?? null }), []);

export const getByCountry = (filters: AnalyticsFilters, artistId?: string) =>
  call<CountryRow[]>("admin_stats_by_country", args(filters, { p_artist_id: artistId ?? null }), []);

export const getBreakdown = (filters: AnalyticsFilters, artistId?: string) =>
  call<BreakdownRow[]>("admin_stats_breakdown", args(filters, { p_artist_id: artistId ?? null }), []);

export async function getListeners(filters: AnalyticsFilters, artistId?: string): Promise<Result<ListenersRow | null>> {
  const result = await call<ListenersRow[]>("admin_stats_listeners", args(filters, { p_artist_id: artistId ?? null }), []);
  return { ...result, data: result.data[0] ?? null };
}

// Auditeurs actifs : toujours sur toute la plateforme et « maintenant » (pas de filtre).
export async function getActiveUsers(): Promise<Result<ActiveUsers | null>> {
  const result = await call<ActiveUsers[]>("admin_stats_active_users", {}, []);
  return { ...result, data: result.data[0] ?? null };
}

export async function getDataQuality(filters: AnalyticsFilters): Promise<Result<DataQuality | null>> {
  const result = await call<DataQuality[]>(
    "admin_stats_data_quality",
    { p_from: filters.from.toISOString(), p_to: filters.to.toISOString() },
    []
  );
  return { ...result, data: result.data[0] ?? null };
}

export const getUserTopArtists = (userId: string, limit = 10) =>
  call<UserArtist[]>("admin_stats_user_top_artists", { p_user_id: userId, p_limit: limit }, []);

// Paramètres d'URL des filtres, pour construire les liens d'une page à l'autre.
export { filterParams };
