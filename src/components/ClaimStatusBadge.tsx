import { STATUS_LABELS, type ClaimStatus } from "@/lib/rightsClaims";

// Pastille de statut d'un signalement : à traiter en alerte, fondé en succès, rejeté en repos, retiré en terminé.
const TONES: Record<string, string> = {
  received: "status--warn",
  in_review: "status--warn",
  upheld: "status--ok",
  rejected: "status--idle",
  withdrawn: "status--soon",
};

export function ClaimStatusBadge({ status }: { status: string }) {
  return <span className={`status ${TONES[status] ?? "status--soon"}`}>{STATUS_LABELS[status as ClaimStatus] ?? status}</span>;
}
