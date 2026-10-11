import { redirect } from "next/navigation";
import { QUEUE_KINDS, loadQueue, reviewPath } from "@/lib/reviewQueue";
import { nextAfter } from "@/lib/reviewQueueLogic";
import { isUuid, oneOf, pick, type SearchParams } from "@/lib/query";
import { requireAdmin } from "@/lib/session";

// Ouvre l'élément à relire ensuite, en mode file d'attente. Sans ?after : le plus
// ancien (bouton « Start reviewing »). Avec ?after=<id> : celui d'après, pour
// « Skip » (on boucle sur le plus ancien si c'était le dernier). Cette page n'a
// aucun effet de bord : elle lit la file et redirige.
export default async function NextToReviewPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireAdmin();

  const params = await searchParams;
  const kind = oneOf(pick(params, "kind"), QUEUE_KINDS);
  if (!kind) redirect("/moderation");

  const afterParam = pick(params, "after");
  const after = isUuid(afterParam) ? afterParam : undefined;

  const { ids } = await loadQueue(kind);
  const next = nextAfter(ids, after);

  if (next) redirect(reviewPath(kind, next));
  // Plus rien : ou la file est vide, ou le seul élément restant est celui qu'on vient de sauter.
  if (after && ids.includes(after)) redirect(reviewPath(kind, after));
  redirect(`/moderation?done=${kind}`);
}
