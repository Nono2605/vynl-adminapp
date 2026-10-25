// Journal des contrôles de contenu (table track_scans, créée par la migration
// 20261014000001_scan_log_and_name_similarity.sql du dépôt de l'API ; spec 15.5). Lecture seule ici.
// Tant que la migration n'est pas appliquée, la table n'existe pas : les pages le disent au lieu de planter.

export type ScanResult = "ok" | "warn" | "fail";

export interface ScanRow {
  id: string;
  track_id: string | null;
  artist_id: string | null;
  check_kind: string;
  provider: string;
  result: ScanResult;
  score: number | string | null;
  matched_track_id: string | null;
  matched_artist_id: string | null;
  detail: Record<string, unknown> | null;
  decision: string | null;
  decided_at: string | null;
  decision_note: string | null;
  created_at: string;
}

export const SCAN_COLUMNS =
  "id, track_id, artist_id, check_kind, provider, result, score, matched_track_id, matched_artist_id, detail, decision, decided_at, decision_note, created_at";

// Table absente : Postgres 42P01, PostgREST PGRST205.
export function isMissingTable(error: { code?: string } | null | undefined): boolean {
  return error?.code === "42P01" || error?.code === "PGRST205";
}

// Un texte lisible pour chaque sorte de contrôle connue ; une sorte inconnue (ajoutée plus tard, comme
// l'empreinte acoustique) reste affichée telle quelle plutôt que d'être cachée.
export function describeScan(scan: Pick<ScanRow, "check_kind" | "score" | "detail">): { title: string; text: string } {
  const detail = scan.detail ?? {};
  // Un contrôle qui n'a pas pu répondre (panne, prestataire injoignable) : jamais présenté comme « rien à signaler ».
  if (detail.unavailable === true) {
    return {
      title: `${scan.check_kind.replace(/_/g, " ")}: could not run`,
      text: "The check did not answer. Run the checks again, or review this track by hand.",
    };
  }
  switch (scan.check_kind) {
    case "file_hash":
      return {
        title: "Same audio file as another artist's track",
        text: "The upload was refused: the file is identical, byte for byte, to one already on Vynl.",
      };
    case "blocked_file":
      return {
        title: "File on the block list",
        text: "The upload was refused: this exact file was removed after a rights holder claim (Claims page).",
      };
    case "duplicate_audio":
      return {
        title: "Same audio file as another artist's track",
        text: "The file is identical, byte for byte, to a file of another artist already on Vynl. Likely a copy.",
      };
    case "blocked_audio":
      return {
        title: "File on the block list",
        text: "This exact file was removed after a rights holder claim (Claims page).",
      };
    case "similar_title":
      return {
        title: "Same title and length as another artist's track",
        text: "Another artist has a track with the same title and almost the same length. Listen to both: deciding whether it is a copy is up to you.",
      };
    case "name_similarity": {
      const name = typeof detail.matched_name === "string" ? detail.matched_name : "another artist";
      const score = scan.score === null || scan.score === undefined ? "" : ` (similarity ${Number(scan.score).toFixed(2)})`;
      return {
        title: "Artist name close to an existing one",
        text: `Close to “${name}”${score}. Check that this is not an imitation of a known artist.`,
      };
    }
    default:
      return { title: scan.check_kind.replace(/_/g, " "), text: "" };
  }
}

// Les contrôles à relire : ni « ok » ni déjà tranchés par un administrateur.
export function needsReview(scan: Pick<ScanRow, "result" | "decision">): boolean {
  return scan.result !== "ok" && scan.decision === null;
}
