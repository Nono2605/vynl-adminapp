import "server-only";
import { ActionError } from "@/lib/actions";
import { blockers, declarationState, sumSplits, trackChecks, type Check } from "@/lib/moderation";
import { supabaseAdmin } from "@/lib/supabase/admin";

export interface TrackForReview {
  id: string;
  title: string;
  status: string;
  duration_seconds: number | null;
  published_at: string | null;
  artist_id: string;
}

// Relit en base l'état d'un morceau et en tire la liste des contrôles. Appelée
// par les actions juste avant de décider : on ne se fie jamais à ce que la page
// affichait quand l'admin a cliqué (elle a pu changer entre-temps).
export async function loadTrackChecks(trackId: string): Promise<{ track: TrackForReview; checks: Check[]; blocking: Check[] }> {
  const db = supabaseAdmin();

  const [track, files, declarations, splits] = await Promise.all([
    db
      .from("tracks")
      .select("id, title, status, duration_seconds, published_at, artist_id")
      .eq("id", trackId)
      .maybeSingle(),
    db.from("track_files").select("id", { count: "exact", head: true }).eq("track_id", trackId),
    db
      .from("ai_declarations")
      .select("status, provenance, declared_at")
      .eq("track_id", trackId)
      .order("declared_at", { ascending: false })
      .limit(1),
    db.from("splits").select("percentage").eq("track_id", trackId),
  ]);

  const failure = [track, files, declarations, splits].find((result) => result.error);
  if (failure?.error) throw new ActionError(`Could not read the track: ${failure.error.message}`);
  if (!track.data) throw new ActionError("Track not found.");

  const checks = trackChecks({
    durationSeconds: track.data.duration_seconds,
    fileCount: files.count ?? 0,
    declaration: declarationState(declarations.data?.[0]),
    splitsTotal: sumSplits(splits.data as { percentage: number | string }[] | null),
  });

  return { track: track.data as TrackForReview, checks, blocking: blockers(checks) };
}
