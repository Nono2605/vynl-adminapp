// Imports relatifs avec extension : ce module est testé par `node --test`, qui ne connaît pas l'alias @/.
import { countriesInRegion, regionLabel } from "./geo.ts";
import { oneOf, pick, type SearchParams } from "./query.ts";

// Filtres des pages d'analytics, lus dans l'URL (rien à stocker : un lien partage la
// vue exacte). Tout ce qui vient de l'URL est validé ; une valeur invalide est
// ignorée, jamais transmise à la base.

export const PRESET_DAYS = { "7d": 7, "30d": 30, "90d": 90 } as const;
export const DEVICES = ["mobile", "tablet", "desktop"] as const;
export const PLANS = ["beta", "subscriber", "free_ad_supported", "trial"] as const;
const MAX_CUSTOM_DAYS = 366;
const DAY_MS = 24 * 3600 * 1000;

export interface AnalyticsFilters {
  // Fenêtre [from, to[ en UTC (borne haute exclue), comme les fonctions SQL.
  from: Date;
  to: Date;
  preset: keyof typeof PRESET_DAYS | null;
  // Dates saisies (YYYY-MM-DD) quand la période est personnalisée.
  fromDate: string;
  toDate: string;
  region: string;
  country: string;
  device: string;
  plan: string;
  // Pays à transmettre à SQL (p_countries) : null = tous.
  countries: string[] | null;
  label: string;
  // Message à montrer si une valeur de l'URL a été écartée.
  warning?: string;
}

function startOfUtcDay(now: Date, offsetDays: number): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offsetDays));
}

function parseDay(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  // new Date("2026-02-31") déborde sur mars : on compare pour refuser une date inexistante.
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : date;
}

function formatDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function parseFilters(params: SearchParams, now: Date = new Date()): AnalyticsFilters {
  let warning: string | undefined;

  // Période : des dates saisies (les deux) l'emportent sur la période prédéfinie.
  const fromDate = pick(params, "from");
  const toDate = pick(params, "to");
  const presetKey = oneOf(pick(params, "range"), ["7d", "30d", "90d"] as const) ?? "30d";

  let from = startOfUtcDay(now, -(PRESET_DAYS[presetKey] - 1));
  let to = startOfUtcDay(now, 1); // demain 00:00 UTC : inclut aujourd'hui en entier
  let preset: AnalyticsFilters["preset"] = presetKey;
  let label = `Last ${PRESET_DAYS[presetKey]} days`;
  let keptFrom = "";
  let keptTo = "";

  if (fromDate || toDate) {
    const start = parseDay(fromDate);
    const end = parseDay(toDate);
    if (!start || !end) {
      warning = "Both dates must be valid (YYYY-MM-DD): the custom period was ignored.";
    } else if (start > end) {
      warning = "The start date is after the end date: the custom period was ignored.";
    } else if ((end.getTime() - start.getTime()) / DAY_MS + 1 > MAX_CUSTOM_DAYS) {
      warning = `The custom period is limited to ${MAX_CUSTOM_DAYS} days: it was ignored.`;
    } else {
      from = start;
      to = new Date(end.getTime() + DAY_MS);
      preset = null;
      keptFrom = formatDay(start);
      keptTo = formatDay(end);
      label = keptFrom === keptTo ? keptFrom : `${keptFrom} to ${keptTo}`;
    }
  }

  const regionParam = pick(params, "region");
  const regionCountries = countriesInRegion(regionParam);
  const region = regionCountries ? regionParam : "";

  const countryParam = pick(params, "country").toUpperCase();
  const country = /^[A-Z]{2}$/.test(countryParam) ? countryParam : "";

  // Un pays précis l'emporte sur la région.
  const countries = country ? [country] : regionCountries;

  return {
    from,
    to,
    preset,
    fromDate: keptFrom,
    toDate: keptTo,
    region,
    country,
    device: oneOf(pick(params, "device"), DEVICES) ?? "",
    plan: oneOf(pick(params, "plan"), PLANS) ?? "",
    countries,
    label,
    warning,
  };
}

// Paramètres d'URL qui reproduisent ces filtres (liens entre onglets, export).
export function filterParams(filters: AnalyticsFilters): Record<string, string | undefined> {
  return {
    range: filters.preset ?? undefined,
    from: filters.fromDate || undefined,
    to: filters.toDate || undefined,
    region: filters.region || undefined,
    country: filters.country || undefined,
    device: filters.device || undefined,
    plan: filters.plan || undefined,
  };
}

// Résumé lisible de ce qui est affiché : « Last 30 days · Europe · mobile ».
export function describeFilters(filters: AnalyticsFilters): string {
  const parts = [filters.label];
  if (filters.country) parts.push(filters.country);
  else if (filters.region) parts.push(regionLabel(filters.region) ?? filters.region);
  if (filters.device) parts.push(filters.device);
  if (filters.plan) parts.push(filters.plan.replace(/_/g, " "));
  return parts.join(" · ");
}
