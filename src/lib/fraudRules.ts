// Les règles de détection de fraude (fonction SQL fraud_detect, migration 20261014000005_fraud_detection.sql du
// dépôt de l'API) et leur lecture pour l'admin : un nom clair, ce qui est cherché, et une phrase par événement.
// Fonctions pures. Les seuils affichés ici DOIVENT suivre ceux de la migration (un changement de seuil est une
// nouvelle migration : mettre ce fichier à jour dans le même commit).

export interface FraudRule {
  type: string;
  title: string;
  what: string;
  // Peut-on exclure les écoutes de cet événement d'un geste ? (sinon : à relire, pas d'exclusion automatique)
  excludable: boolean;
}

export const FRAUD_RULES: FraudRule[] = [
  {
    type: "round_the_clock",
    title: "Listening around the clock",
    what: "An account listens 18 hours or more in one day (22 hours: high severity).",
    excludable: true,
  },
  {
    type: "track_repetition",
    title: "The same track again and again",
    what: "An account plays the same track 40 times or more in one day (100: medium, 300: high).",
    excludable: true,
  },
  {
    type: "qualification_farming",
    title: "Stopping right after 30 seconds",
    what: "50 plays or more that stop just after the 30 seconds that count, on tracks of 90 seconds and more, and 80% or more of the account's counted plays that day (150 plays: high).",
    excludable: true,
  },
  {
    type: "new_account_burst",
    title: "A track carried by brand-new accounts",
    what: "20 plays or more in a day, from 10 accounts or more, 80% or more from accounts created in the last 7 days (100 plays: high).",
    excludable: true,
  },
  {
    type: "shared_ip_fingerprint",
    title: "Several accounts behind one IP fingerprint",
    what: "One IP fingerprint of the day serves 4 accounts or more, 40 plays or more, 60% or more on the same artist (10 accounts: high).",
    excludable: true,
  },
  {
    type: "many_countries",
    title: "Many countries in one day",
    what: "An account listens from 4 countries or more in one day (7: medium). Possible account sharing or a relay: to review, never excluded in one gesture.",
    excludable: false,
  },
];

const BY_TYPE = new Map(FRAUD_RULES.map((rule) => [rule.type, rule]));

export function ruleFor(type: string): FraudRule | undefined {
  return BY_TYPE.get(type);
}

export function isExcludable(type: string): boolean {
  return BY_TYPE.get(type)?.excludable ?? false;
}

type Details = Record<string, unknown> | null | undefined;

const num = (value: unknown): number | null => {
  const n = Number(value);
  return value === null || value === undefined || value === "" || !Number.isFinite(n) ? null : n;
};
const pct = (value: unknown): string => {
  const n = num(value);
  return n === null ? "?" : `${Math.round(n * 100)}%`;
};
const dayOf = (details: Record<string, unknown>): string => (typeof details.day === "string" ? details.day : "that day");

// Une phrase lisible pour un événement. Un type inconnu (une règle ajoutée plus tard) reste affiché tel quel.
export function describeFraudEvent(type: string, raw: Details): string {
  const details = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const day = dayOf(details);
  switch (type) {
    case "round_the_clock":
      return `${num(details.hours) ?? "?"} hours of listening validated on ${day}, over ${num(details.plays) ?? "?"} plays.`;
    case "track_repetition":
      return `${num(details.plays) ?? "?"} plays of the same track on ${day}.`;
    case "qualification_farming":
      return `${num(details.just_qualified_plays) ?? "?"} of ${num(details.qualified_plays) ?? "?"} counted plays (${pct(details.share)}) stopped right after 30 seconds on ${day}.`;
    case "new_account_burst":
      return `${num(details.plays) ?? "?"} plays from ${num(details.accounts) ?? "?"} accounts on ${day}; ${pct(details.new_account_share)} from accounts under 7 days old.`;
    case "shared_ip_fingerprint":
      return `${num(details.accounts) ?? "?"} accounts behind one IP fingerprint on ${day}, ${num(details.plays) ?? "?"} plays, ${pct(details.top_artist_share)} on the same artist.`;
    case "many_countries":
      return `Listening from ${num(details.countries) ?? "?"} countries on ${day}${
        Array.isArray(details.country_codes) ? ` (${(details.country_codes as unknown[]).join(", ")})` : ""
      }.`;
    default:
      return "";
  }
}

// Ce qui a déjà été exclu d'après cet événement, s'il y a eu une exclusion.
export function excludedCount(raw: Details): number {
  const details = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return num(details.excluded_plays) ?? 0;
}

// Un résumé des comptes rendus par fraud_detect() : « 2 round the clock, 1 track repetition ».
export function summarizeDetection(rows: { rule: string; created: number }[]): string {
  const events = rows.filter((row) => row.rule !== "scores_refreshed" && row.created > 0);
  if (events.length === 0) return "No new event.";
  const total = events.reduce((sum, row) => sum + row.created, 0);
  const detail = events.map((row) => `${row.created} ${(ruleFor(row.rule)?.title ?? row.rule).toLowerCase()}`).join(", ");
  return `${total} new event${total > 1 ? "s" : ""}: ${detail}.`;
}
