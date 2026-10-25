// Ce que disent les contrôles automatiques d'UN morceau, en une ligne : fonction PURE (aucune base) pour être testée seule ;
// le chargement est dans scanSummaries.ts. Même résumé pour la fiche du morceau, la file de modération et le contrôle
// fait côté serveur avant de publier.
//
// Les tâches (table scan_jobs) disent si les contrôles ont tourné ; le journal (track_scans) dit ce qu'ils ont trouvé.
// Seule la DERNIÈRE tâche compte : si l'artiste a remplacé son fichier et renvoyé le morceau, les résultats d'avant ne
// pèsent plus (ils restent dans le journal, comme preuve).

export type ScanState =
  | "none" // aucun contrôle n'a jamais été lancé pour ce morceau
  | "pending" // une tâche est en file ou en cours
  | "unavailable" // la dernière tâche a échoué, ou traîne sans aboutir : à relire à la main
  | "done"; // la dernière tâche est terminée

export interface ScanSummary {
  state: ScanState;
  /** Alertes graves à trancher (fail non écarté), ou problème déjà confirmé par un administrateur. */
  failing: number;
  /** Dont : problèmes confirmés. */
  confirmed: number;
  /** Avertissements à regarder (warn non tranché). */
  warning: number;
  /** Contrôles qui n'ont pas pu répondre (non tranchés). */
  unavailable: number;
  /** Nombre de sortes de contrôles de la dernière tâche. */
  checks: number;
}

export interface ScanJobRow {
  track_id: string;
  status: string;
  created_at: string;
}

export interface ScanResultRow {
  track_id: string | null;
  check_kind: string;
  result: string;
  decision: string | null;
  created_at: string;
  detail: Record<string, unknown> | null;
}

// Ces contrôles sont faits à l'ENVOI du fichier ou du nom (refus immédiat) : ils restent dans le journal, mais ne pèsent
// pas sur la publication d'un morceau (un fichier refusé n'est pas entré dans le catalogue).
export const UPLOAD_TIME_KINDS: readonly string[] = ["file_hash", "blocked_file", "name_similarity"];

// Une tâche « ouverte » depuis plus longtemps que ça n'aboutira probablement pas (l'API dormait, la tâche est restée en
// file) : on ne bloque pas la décision indéfiniment, on le dit.
export const PENDING_MAX_AGE_MS = 30 * 60_000;

const EMPTY: Omit<ScanSummary, "state"> = { failing: 0, confirmed: 0, warning: 0, unavailable: 0, checks: 0 };

export function summarizeScans(jobs: ScanJobRow[], scans: ScanResultRow[], now: number): ScanSummary {
  const latest = [...jobs].sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  if (!latest) return { state: "none", ...EMPTY };

  if (latest.status === "queued" || latest.status === "running") {
    const age = now - Date.parse(latest.created_at);
    return { state: age > PENDING_MAX_AGE_MS ? "unavailable" : "pending", ...EMPTY };
  }
  if (latest.status === "failed") return { state: "unavailable", ...EMPTY };

  // Dernière tâche terminée : ses résultats, un par sorte de contrôle (le plus récent si elle a été écrite deux fois).
  const byKind = new Map<string, ScanResultRow>();
  for (const scan of scans) {
    if (UPLOAD_TIME_KINDS.includes(scan.check_kind)) continue;
    if (scan.created_at < latest.created_at) continue;
    const seen = byKind.get(scan.check_kind);
    if (!seen || scan.created_at > seen.created_at) byKind.set(scan.check_kind, scan);
  }

  const summary: ScanSummary = { state: "done", ...EMPTY, checks: byKind.size };
  for (const scan of byKind.values()) {
    const confirmed = scan.decision === "confirmed";
    const dismissed = scan.decision === "dismissed";
    if (confirmed) {
      summary.confirmed++;
      summary.failing++;
    } else if (scan.result === "fail" && !dismissed) {
      summary.failing++;
    } else if (scan.result === "warn" && scan.decision === null) {
      if (scan.detail?.unavailable === true) summary.unavailable++;
      else summary.warning++;
    }
  }
  return summary;
}
