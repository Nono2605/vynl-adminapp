// Contrôle D4 (spec 15.5) : un morceau d'UN AUTRE artiste qui porte le même titre et dure presque autant (à 2 secondes
// près). Un simple avertissement pour la relecture : deux œuvres peuvent légitimement s'appeler « Intro ». Le même
// artiste qui republie son titre (un single puis l'album) n'est pas concerné.

// Écart de durée toléré, en secondes (spec 15.5, D4).
export const SIMILAR_DURATION_SECONDS = 2;

export interface TrackLite {
  id: string;
  title: string;
  duration_seconds: number | null;
  artist_id: string;
}

// Titre comparable : sans casse, sans accents, sans ponctuation, espaces réduits.
export function normalizeTitle(title: string): string {
  return title
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function findSimilarTracks(track: TrackLite, candidates: TrackLite[]): TrackLite[] {
  if (track.duration_seconds === null) return [];
  const title = normalizeTitle(track.title);
  if (title === "") return [];
  return candidates.filter(
    (other) =>
      other.id !== track.id &&
      other.artist_id !== track.artist_id &&
      other.duration_seconds !== null &&
      Math.abs(other.duration_seconds - track.duration_seconds!) <= SIMILAR_DURATION_SECONDS &&
      normalizeTitle(other.title) === title
  );
}

// Échappe % _ et \ pour une recherche « ilike » qui doit comprendre le titre à la lettre.
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

// Les morceaux candidats en base : même titre (à la casse près), d'autres artistes. Les variantes d'accents ou de
// ponctuation ne sont pas cherchées en base (limite connue) ; findSimilarTracks, lui, les accepterait. `null` si la
// recherche échoue : le contrôle est alors simplement absent, il ne bloque jamais une décision.
interface TitleQuery extends PromiseLike<{ data: unknown[] | null; error: { message: string } | null }> {
  ilike(column: string, pattern: string): TitleQuery;
  neq(column: string, value: string): TitleQuery;
  limit(count: number): TitleQuery;
}
export interface SimilarDb {
  from(table: string): { select(columns: string): TitleQuery };
}

export async function loadSimilarTracks(db: SimilarDb, track: TrackLite): Promise<TrackLite[] | null> {
  if (track.duration_seconds === null || normalizeTitle(track.title) === "") return [];
  const { data, error } = await db
    .from("tracks")
    .select("id, title, duration_seconds, artist_id")
    .ilike("title", escapeLike(track.title.trim()))
    .neq("artist_id", track.artist_id)
    .limit(50);
  if (error) {
    console.error(`Similar-track check unavailable: ${error.message}`);
    return null;
  }
  return findSimilarTracks(track, (data ?? []) as TrackLite[]);
}
