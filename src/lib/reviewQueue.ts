import "server-only";
import { redirect } from "next/navigation";
import { nextAfter } from "@/lib/reviewQueueLogic";
import { supabaseAdmin } from "@/lib/supabase/admin";

export type QueueKind = "tracks" | "albums";

export const QUEUE_KINDS = ["tracks", "albums"] as const;

export const QUEUE_LABEL: Record<QueueKind, string> = { tracks: "Tracks", albums: "Albums" };

// Au-delà, on ne lit plus que les 500 plus anciens identifiants : une file aussi
// longue se traite de toute façon par le début.
const QUEUE_READ_LIMIT = 500;

// Page de relecture d'un élément, en mode file (?flow=1).
export function reviewPath(kind: QueueKind, id: string): string {
  return `/catalog/${kind}/${id}?flow=1`;
}

// Passe à l'élément suivant sans décider (voir la page /moderation/next).
export function skipPath(kind: QueueKind, afterId?: string): string {
  return afterId ? `/moderation/next?kind=${kind}&after=${afterId}` : `/moderation/next?kind=${kind}`;
}

export interface Queue {
  ids: string[];
  total: number;
}

// La file : identifiants « in_review », du plus ancien au plus récent. Même
// ordre que la page Moderation (updated_at, puis id pour un ordre stable).
export async function loadQueue(kind: QueueKind): Promise<Queue> {
  const { data, count, error } = await supabaseAdmin()
    .from(kind)
    .select("id", { count: "exact" })
    .eq("status", "in_review")
    .order("updated_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(QUEUE_READ_LIMIT);

  if (error) throw new Error(`Could not load the review queue: ${error.message}`);
  const ids = ((data ?? []) as { id: string }[]).map((row) => row.id);
  return { ids, total: count ?? ids.length };
}

// Ce que la page suivante affiche pour rappeler la décision qui vient d'être prise.
export function decisionQuery(decision: string, title: string): string {
  return `last=${encodeURIComponent(decision)}&lastTitle=${encodeURIComponent(title.slice(0, 80))}`;
}

// Après une décision en mode file : ouvre l'élément suivant, ou revient à la
// Modération quand la file est vide. Appelle redirect() : ne revient pas.
export async function advanceAfterDecision(kind: QueueKind, decidedId: string, decision: string, title: string): Promise<never> {
  const { ids } = await loadQueue(kind);
  // L'élément décidé n'est plus « in_review », mais on l'écarte quand même par prudence.
  const next = nextAfter(ids.filter((id) => id !== decidedId));
  const query = decisionQuery(decision, title);

  if (next) redirect(`${reviewPath(kind, next)}&${query}`);
  redirect(`/moderation?done=${kind}&${query}`);
}
