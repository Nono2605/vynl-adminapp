import "server-only";
import { isMissingTable } from "@/lib/scans";
import { summarizeScans, UPLOAD_TIME_KINDS, type ScanJobRow, type ScanResultRow, type ScanSummary } from "@/lib/scanSummary";
import { supabaseAdmin } from "@/lib/supabase/admin";

// Le résumé des contrôles automatiques de plusieurs morceaux, en deux lectures (tâches, résultats). `undefined` quand
// la file des contrôles n'existe pas encore (migration 20261026000000 de l'API pas appliquée) ou n'est pas lisible :
// la page marche alors comme avant, sans cette ligne. Chaque morceau demandé a une entrée dans la table rendue.
const READ_LIMIT = 5000;

export async function loadScanSummaries(
  db: ReturnType<typeof supabaseAdmin>,
  trackIds: string[],
  now: number = Date.now()
): Promise<Map<string, ScanSummary> | undefined> {
  if (trackIds.length === 0) return new Map();

  const [jobs, scans] = await Promise.all([
    db
      .from("scan_jobs")
      .select("track_id, status, created_at")
      .in("track_id", trackIds)
      .order("created_at", { ascending: false })
      .limit(READ_LIMIT),
    db
      .from("track_scans")
      .select("track_id, check_kind, result, decision, created_at, detail")
      .in("track_id", trackIds)
      .not("check_kind", "in", `(${UPLOAD_TIME_KINDS.join(",")})`)
      .order("created_at", { ascending: false })
      .limit(READ_LIMIT),
  ]);

  if (isMissingTable(jobs.error) || isMissingTable(scans.error)) return undefined;
  if (jobs.error || scans.error) {
    console.error(`Automatic checks unavailable: ${(jobs.error ?? scans.error)?.message}`);
    return undefined;
  }

  const jobsByTrack = new Map<string, ScanJobRow[]>();
  for (const job of (jobs.data ?? []) as ScanJobRow[]) {
    jobsByTrack.set(job.track_id, [...(jobsByTrack.get(job.track_id) ?? []), job]);
  }
  const scansByTrack = new Map<string, ScanResultRow[]>();
  for (const scan of (scans.data ?? []) as ScanResultRow[]) {
    if (!scan.track_id) continue;
    scansByTrack.set(scan.track_id, [...(scansByTrack.get(scan.track_id) ?? []), scan]);
  }

  return new Map(trackIds.map((id) => [id, summarizeScans(jobsByTrack.get(id) ?? [], scansByTrack.get(id) ?? [], now)]));
}
