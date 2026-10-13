import "server-only";
import type { supabaseAdmin } from "@/lib/supabase/admin";

// Le genre des morceaux (colonne tracks.genre_code et table genres, migration de l'API
// 20261014000002_genres.sql). Lecture TOLÉRANTE : tant que la migration n'est pas appliquée, la colonne
// n'existe pas et une requête qui la nommerait ferait échouer toute la page. Ces lectures sont donc à part
// et ne lèvent jamais : `null` veut dire « pas disponible », et le contrôle de genre est alors simplement absent.

type Db = ReturnType<typeof supabaseAdmin>;

// Par morceau : le code, ou null s'il n'en a pas. Le résultat vaut null (pas de Map) si on ne peut pas lire.
export async function loadTrackGenres(db: Db, trackIds: string[]): Promise<Map<string, string | null> | null> {
  if (trackIds.length === 0) return new Map();
  const { data, error } = await db.from("tracks").select("id, genre_code").in("id", trackIds);
  if (error) return null;
  return new Map(
    ((data ?? []) as { id: string; genre_code: string | null }[]).map((row) => [row.id, row.genre_code ?? null] as const)
  );
}

// Le libellé affiché d'un code (« hip_hop_rap » → « Hip-hop / Rap »), ou le code lui-même si on ne le trouve pas.
export async function genreLabel(db: Db, code: string): Promise<string> {
  const { data, error } = await db.from("genres").select("label").eq("code", code).maybeSingle();
  return error || !data ? code : (data as { label: string }).label;
}
