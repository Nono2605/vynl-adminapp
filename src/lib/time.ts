// Dates relatives, calculées ici plutôt que dans les composants (la règle de
// pureté de React interdit Date.now() pendant le rendu).
const DAY_MS = 24 * 3600 * 1000;

// Début du jour UTC, `days` jours avant aujourd'hui (0 = aujourd'hui 00:00 UTC).
export function startOfUtcDay(daysAgo = 0): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysAgo));
}

// Il y a `hours` heures, à la seconde près.
export function hoursAgo(hours: number): Date {
  return new Date(Date.now() - hours * 3600 * 1000);
}

export function daysAgo(days: number): Date {
  return new Date(Date.now() - days * DAY_MS);
}
