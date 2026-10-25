// Signalements des ayants droit (spec 15.3, C4) : états, libellés, numéro de dossier et règles de lecture, en fonctions
// pures. La base (API/supabase/migrations/20261025000002_rights_claims.sql) impose les mêmes transitions ; ici elles
// servent à n'afficher que les boutons permis et à refuser tôt, avec un message clair.

export const CLAIM_STATUSES = ["received", "in_review", "upheld", "rejected", "withdrawn"] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

export const OPEN_STATUSES: readonly ClaimStatus[] = ["received", "in_review"];
export const DECIDED_STATUSES: readonly ClaimStatus[] = ["upheld", "rejected", "withdrawn"];

export function isDecided(status: string): boolean {
  return (DECIDED_STATUSES as readonly string[]).includes(status);
}

// Un signalement ouvert depuis plus longtemps que ça est « en retard ». Valeur PROVISOIRE : le délai de réponse est
// à fixer avec le juriste (spec 15.3, C4 : « délai de réponse court »).
export const CLAIM_RESPONSE_DAYS = 3;

export const STATUS_LABELS: Record<ClaimStatus, string> = {
  received: "Received",
  in_review: "In review",
  upheld: "Upheld",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
};

export const CLAIM_TYPE_LABELS: Record<string, string> = {
  recording: "A recording is reproduced",
  composition: "Melody or lyrics are reproduced",
  voice_or_likeness: "A voice or likeness is imitated",
  name_or_trademark: "An artist name or trademark is used",
  other: "Other",
};

export const CAPACITY_LABELS: Record<string, string> = {
  owner: "Rights holder",
  agent: "Authorized representative",
  performer: "Performer whose voice or likeness is imitated",
};

// Le numéro de dossier donné au demandeur (même règle que l'API : lib/rightsClaim.ts).
export function claimReference(claimNumber: number | string): string {
  return `RC-${String(claimNumber).padStart(5, "0")}`;
}

const TRANSITIONS: Record<ClaimStatus, readonly ClaimStatus[]> = {
  received: ["in_review", "upheld", "rejected", "withdrawn"],
  in_review: ["upheld", "rejected", "withdrawn"],
  upheld: [],
  rejected: [],
  withdrawn: [],
};

export function canTransition(from: string, to: ClaimStatus): boolean {
  return (TRANSITIONS[from as ClaimStatus] ?? []).includes(to);
}

const UUID_IN_TEXT = /[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;

// Le demandeur colle souvent l'adresse du morceau : on en tire l'identifiant, pour préremplir la décision.
export function extractTrackId(text: string): string | null {
  return UUID_IN_TEXT.exec(text)?.[0].toLowerCase() ?? null;
}

// Jours entiers écoulés depuis une date (0 le jour même).
export function ageInDays(createdAt: string, now: Date): number {
  const then = Date.parse(createdAt);
  if (Number.isNaN(then)) return 0;
  return Math.max(0, Math.floor((now.getTime() - then) / 86_400_000));
}

export function isOverdue(claim: { status: string; created_at: string }, now: Date): boolean {
  return (OPEN_STATUSES as readonly string[]).includes(claim.status) && ageInDays(claim.created_at, now) >= CLAIM_RESPONSE_DAYS;
}

// Les artistes visés par plusieurs signalements FONDÉS : à examiner (suspension des récidivistes, spec 15.3 C4).
export function repeatArtists(rows: { artist_id: string | null; status: string }[], minimum = 2): { artist_id: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (row.status !== "upheld" || !row.artist_id) continue;
    counts.set(row.artist_id, (counts.get(row.artist_id) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count >= minimum)
    .map(([artist_id, count]) => ({ artist_id, count }))
    .sort((a, b) => b.count - a.count);
}
