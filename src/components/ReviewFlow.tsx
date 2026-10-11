import Link from "next/link";
import { QUEUE_LABEL, skipPath, type QueueKind } from "@/lib/reviewQueue";

const DECISION_TEXT: Record<string, string> = {
  approve: "published",
  refuse: "sent back to the creator",
};

// Rappel de la décision qui vient d'être prise (après l'avance automatique).
// Le titre vient de l'URL : on n'affiche que du texte, jamais du HTML.
export function LastDecision({ decision, title }: { decision: string; title: string }) {
  const text = DECISION_TEXT[decision];
  if (!text || !title) return null;

  return (
    <p className="flow-last" role="status">
      “{title}” {text}.
    </p>
  );
}

// Bandeau du mode file d'attente, en haut d'une fiche de relecture : où l'on en
// est, passer au suivant sans décider, quitter. `position` est null quand
// l'élément n'est (ou n'est plus) pas dans la file.
export function ReviewFlowBar({
  kind,
  currentId,
  position,
  total,
  lastDecision,
  lastTitle,
}: {
  kind: QueueKind;
  currentId: string;
  position: number | null;
  total: number;
  lastDecision: string;
  lastTitle: string;
}) {
  return (
    <>
      <div className="flow-bar">
        <span>
          <strong>Review queue</strong> · {QUEUE_LABEL[kind]} ·{" "}
          {position ? `${position} of ${total}` : `${total} waiting`}
        </span>
        <span className="flow-bar__actions">
          {/* prefetch={false} : ces liens ne font que rediriger, inutile de les précharger. */}
          <Link href={skipPath(kind, currentId)} prefetch={false} className="btn btn-secondary btn-sm">
            Skip
          </Link>
          <Link href="/moderation" className="text-link">
            Exit queue
          </Link>
        </span>
      </div>
      <LastDecision decision={lastDecision} title={lastTitle} />
    </>
  );
}
