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
export function describeScan(scan: Pick<ScanRow, "check_kind" | "score" | "detail"> & { result?: string }): { title: string; text: string } {
  const detail = scan.detail ?? {};
  // Un contrôle qui n'a pas pu répondre (panne, prestataire injoignable) : jamais présenté comme « rien à signaler ».
  if (detail.unavailable === true) {
    const reason = typeof detail.message === "string" && detail.message ? ` (${detail.message})` : "";
    return {
      title: `${scan.check_kind.replace(/_/g, " ")}: could not run`,
      text: `The check did not answer${reason}. Run the checks again, or review this track by hand.`,
    };
  }
  // Un résultat « ok » dit qu'il n'y a RIEN : le texte d'une alerte (« le fichier est identique… ») serait trompeur.
  if (scan.result === "ok") {
    const clear: Record<string, { title: string; text: string }> = {
      duplicate_audio: { title: "Same audio file as another artist's track", text: "No identical file found among other artists' tracks." },
      blocked_audio: { title: "File on the block list", text: "The file is not on the block list." },
      similar_title: { title: "Same title and length as another artist's track", text: "No track by another artist with the same title and length." },
      fingerprint: { title: "Known recordings (audio fingerprint)", text: fingerprintClearText(detail, scan.score) },
    };
    if (clear[scan.check_kind]) return clear[scan.check_kind];
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
    case "fingerprint":
      return { title: "Known recordings (audio fingerprint)", text: fingerprintFoundText(detail) };
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

interface FingerprintMatch {
  title?: unknown;
  artists?: unknown;
  score?: unknown;
  seen_at_seconds?: unknown;
}

function matchesOf(detail: Record<string, unknown>): FingerprintMatch[] {
  return Array.isArray(detail.matches) ? (detail.matches as FingerprintMatch[]) : [];
}

function samplesText(detail: Record<string, unknown>): string {
  const samples = Array.isArray(detail.samples) ? detail.samples.length : 0;
  return samples > 0 ? `${samples} sample${samples > 1 ? "s" : ""}` : "the samples";
}

// Rien d'assez sûr n'a été reconnu (aucune correspondance, ou une correspondance sous le seuil d'alerte).
function fingerprintClearText(detail: Record<string, unknown>, score: ScanRow["score"] | undefined): string {
  const weak = matchesOf(detail).length > 0 && score !== null && score !== undefined ? ` The weakest hint scored ${Number(score)}: below the alert level.` : "";
  const reused = detail.reused === true ? " Result reused from an earlier check of the same file." : "";
  return `No known recording recognised in ${samplesText(detail)}.${weak}${reused}`;
}

// Ce que le prestataire a reconnu : réservé à l'administration, jamais montré à l'artiste.
function fingerprintFoundText(detail: Record<string, unknown>): string {
  const [first, ...others] = matchesOf(detail);
  if (!first) return "A known recording may be in this track.";
  const artists = Array.isArray(first.artists) ? first.artists.filter((name) => typeof name === "string").join(", ") : "";
  const where = Array.isArray(first.seen_at_seconds) && first.seen_at_seconds.length > 0 ? `, heard at ${first.seen_at_seconds.map((s) => `${s}s`).join(", ")}` : "";
  const more = others.length > 0 ? ` and ${others.length} other${others.length > 1 ? "s" : ""}` : "";
  const reused = detail.reused === true ? " (result reused from an earlier check of the same file)" : "";
  return `Looks like “${String(first.title ?? "?")}”${artists ? ` by ${artists}` : ""} (score ${Number(first.score ?? 0)}${where})${more}${reused}. Listen to both before deciding.`;
}
