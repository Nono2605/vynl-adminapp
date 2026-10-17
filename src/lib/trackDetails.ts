import "server-only";
import type { supabaseAdmin } from "@/lib/supabase/admin";
import { creditRoleLabel } from "@/lib/trackCredits";

// Autres genres, styles libres et crédits d'un morceau (migration 20261018000000_release_details.sql de l'API) :
// de quoi relire un morceau (un crédit qui nomme un artiste connu, des styles trompeurs). Lecture TOLÉRANTE :
// tant que la migration n'est pas appliquée, colonnes et table n'existent pas ; `null` veut dire « pas
// disponible » et la page n'affiche simplement pas ces lignes. Ne lève jamais.

type Db = ReturnType<typeof supabaseAdmin>;

export interface TrackDetails {
  extraGenreCodes: string[];
  tags: string[];
  credits: { role: string; roleLabel: string; name: string; artistId: string | null }[];
}

export async function loadTrackDetails(db: Db, trackId: string): Promise<TrackDetails | null> {
  const track = await db.from("tracks").select("extra_genre_codes, tags").eq("id", trackId).maybeSingle();
  if (track.error) return null;
  const credits = await db
    .from("track_credits")
    .select("role, display_name, artist_id, position")
    .eq("track_id", trackId)
    .order("position", { ascending: true });
  if (credits.error) return null;

  const row = (track.data ?? {}) as { extra_genre_codes?: unknown; tags?: unknown };
  const strings = (value: unknown) =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  return {
    extraGenreCodes: strings(row.extra_genre_codes),
    tags: strings(row.tags),
    credits: ((credits.data ?? []) as { role: string; display_name: string; artist_id: string | null }[]).map((credit) => ({
      role: credit.role,
      roleLabel: creditRoleLabel(credit.role),
      name: credit.display_name,
      artistId: credit.artist_id ?? null,
    })),
  };
}
