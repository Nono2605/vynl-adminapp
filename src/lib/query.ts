// Lecture sûre des paramètres d'URL (filtres, pagination). Tout ce qui vient de
// l'URL est une entrée non fiable : on ne la passe à la base qu'après l'avoir
// validée ou échappée.
export type SearchParams = Record<string, string | string[] | undefined>;

export const PAGE_SIZE = 25;

export function pick(params: SearchParams, key: string): string {
  const value = params[key];
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

export function parsePage(params: SearchParams): number {
  const page = Number.parseInt(pick(params, "page"), 10);
  return Number.isFinite(page) && page > 0 ? page : 1;
}

// Plage [from, to] (inclusive) pour .range() de Supabase.
export function pageRange(page: number): [number, number] {
  const from = (page - 1) * PAGE_SIZE;
  return [from, from + PAGE_SIZE - 1];
}

// Renvoie la valeur si elle fait partie de la liste, sinon undefined.
export function oneOf<T extends string>(value: string, allowed: readonly T[]): T | undefined {
  return (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID.test(value);
}

// Échappe les jokers de LIKE : une recherche « 50% » ne doit pas devenir un
// motif qui ressort tout.
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

// URL de la même page avec d'autres paramètres ; les valeurs vides sont
// retirées pour garder des adresses lisibles.
export function withParams(basePath: string, params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `${basePath}?${query}` : basePath;
}

// PostgREST renvoie un objet pour une relation « un », un tableau pour « plusieurs » ;
// selon la détection de la clé, une relation « un » peut aussi arriver en tableau.
export function first<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

// Résultat d'un embed `table(count)` : [{ count: n }].
export function embeddedCount(value: { count: number }[] | { count: number } | null | undefined): number {
  return first(value)?.count ?? 0;
}
