// Pastille de statut. Couleurs fonctionnelles de la DA : succès pour ce qui est
// actif ou en ligne, alerte pour ce qui attend une action, erreur pour un échec,
// bleu pour un rôle, neutre pour un état de repos, pointillé pour ce qui est
// terminé ou archivé. Un statut inconnu reste lisible (pointillé).
const VARIANTS: Record<string, string> = {
  // succès
  active: "status--ok",
  published: "status--ok",
  approved: "status--ok",
  paid: "status--ok",
  paying: "status--ok",
  // à traiter
  in_review: "status--warn",
  trialing: "status--warn",
  trial: "status--warn",
  past_due: "status--warn",
  pending_review: "status--warn",
  pending: "status--warn",
  processing: "status--warn",
  suspended: "status--warn",
  // erreur
  failed: "status--error",
  rejected: "status--error",
  high: "status--error",
  critical: "status--error",
  medium: "status--warn",
  low: "status--idle",
  resolved: "status--ok",
  // rôles
  admin: "status--info",
  creator: "status--info",
  // repos
  draft: "status--idle",
  listener: "status--idle",
  free: "status--idle",
  open: "status--idle",
  // terminé
  archived: "status--soon",
  canceled: "status--soon",
  expired: "status--soon",
  deleted: "status--soon",
  closed: "status--soon",
};

export function StatusBadge({ status }: { status: string }) {
  const variant = VARIANTS[status] ?? "status--soon";

  return <span className={`status ${variant}`}>{status.replace(/_/g, " ")}</span>;
}
