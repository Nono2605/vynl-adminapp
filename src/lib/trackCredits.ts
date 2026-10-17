// Les rôles d'un crédit de morceau (track_credits.role), en toutes lettres. Pur, testé avec `npm test`.

const ROLE_LABELS: Record<string, string> = {
  featured: "Featured",
  producer: "Producer",
  writer: "Writer",
};

// Un rôle inconnu (ajouté plus tard) reste lisible plutôt que d'être caché.
export function creditRoleLabel(role: string): string {
  return ROLE_LABELS[role] ?? role.replace(/_/g, " ");
}
