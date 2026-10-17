// Relecture des noms d'artistes (colonnes name_status, name_review_note : migration
// 20261017000000_artist_name_review.sql du dépôt de l'API). Fonctions pures, testées avec `npm test`.

// Colonne absente : Postgres 42703, PGRST204 dans le cache de schéma de PostgREST. Tant que la migration
// n'est pas appliquée, les pages le disent au lieu de planter.
export function isMissingColumn(error: { code?: string } | null | undefined): boolean {
  return error?.code === "42703" || error?.code === "PGRST204";
}

export interface SimilarName {
  name: string;
  score: number | null;
}

// Les noms proches d'un artiste, tels que les contrôles de ressemblance les ont journalisés : du plus
// ressemblant au moins ressemblant, sans doublon.
export function similarNames(
  scans: { score: number | string | null; detail: Record<string, unknown> | null }[]
): SimilarName[] {
  const best = new Map<string, number | null>();
  for (const scan of scans) {
    const name = scan.detail?.matched_name;
    if (typeof name !== "string" || !name.trim()) continue;
    const parsed = scan.score === null || scan.score === undefined ? NaN : Number(scan.score);
    const score = Number.isFinite(parsed) ? parsed : null;
    const known = best.get(name);
    if (known === undefined || (score !== null && (known === null || score > known))) best.set(name, score);
  }
  return [...best.entries()]
    .map(([name, score]) => ({ name, score }))
    .sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || a.name.localeCompare(b.name));
}
