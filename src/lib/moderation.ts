// Règles de la revue d'un morceau, en fonctions pures : la même liste de
// contrôles sert à l'affichage (fiche du morceau, file de modération) ET à la
// vérification faite côté serveur avant de publier. Un bouton grisé n'est
// jamais la seule barrière.
//
// Le futur scan audio (détection de plagiat / droits d'auteur) s'ajoutera ici
// comme un contrôle de plus, avec le même état « ok / warn / fail » : un « fail »
// bloque la publication.

export type DeclarationState = "none" | "pending_review" | "approved" | "rejected";
export type CheckState = "ok" | "warn" | "fail";

export interface Check {
  key: "audio" | "duration" | "declaration" | "splits";
  label: string;
  state: CheckState;
  detail: string;
}

export interface TrackCheckInput {
  durationSeconds: number | null;
  fileCount: number;
  declaration: DeclarationState;
  // Somme des parts (%) si des parts existent, null s'il n'y en a aucune.
  splitsTotal: number | null;
}

export function declarationState(latest: { status: string } | null | undefined): DeclarationState {
  if (!latest) return "none";
  return latest.status === "approved" || latest.status === "rejected" ? latest.status : "pending_review";
}

// Décision de produit (11 oct. 2026) : la déclaration IA n'a PAS à être relue pour
// publier. Une déclaration « en attente » ne bloque rien, et un morceau SANS déclaration
// n'est qu'un avertissement. Seule une déclaration REFUSÉE par un administrateur bloque
// encore la publication (c'est une décision explicite, pas une file d'attente).
export function trackChecks(input: TrackCheckInput): Check[] {
  const checks: Check[] = [];

  checks.push(
    input.fileCount > 0
      ? { key: "audio", label: "Audio file", state: "ok", detail: `${input.fileCount} file${input.fileCount > 1 ? "s" : ""} uploaded` }
      : { key: "audio", label: "Audio file", state: "fail", detail: "No audio file uploaded" }
  );

  checks.push(
    input.durationSeconds !== null && input.durationSeconds > 0
      ? { key: "duration", label: "Duration", state: "ok", detail: "Measured from the audio file" }
      : { key: "duration", label: "Duration", state: "fail", detail: "No duration recorded" }
  );

  const declaration: Record<DeclarationState, Check> = {
    approved: { key: "declaration", label: "AI declaration", state: "ok", detail: "Approved" },
    none: { key: "declaration", label: "AI declaration", state: "warn", detail: "The creator has not declared how this track was made" },
    pending_review: { key: "declaration", label: "AI declaration", state: "ok", detail: "Declared by the creator (no review needed to publish)" },
    rejected: { key: "declaration", label: "AI declaration", state: "fail", detail: "Rejected: the track cannot be published as declared" },
  };
  checks.push(declaration[input.declaration]);

  if (input.splitsTotal === null) {
    checks.push({ key: "splits", label: "Revenue splits", state: "ok", detail: "None defined" });
  } else if (Math.abs(input.splitsTotal - 100) < 0.001) {
    checks.push({ key: "splits", label: "Revenue splits", state: "ok", detail: "Add up to 100%" });
  } else {
    checks.push({
      key: "splits",
      label: "Revenue splits",
      state: "fail",
      detail: `Add up to ${Number(input.splitsTotal.toFixed(3))}%, not 100%`,
    });
  }

  return checks;
}

export function blockers(checks: Check[]): Check[] {
  return checks.filter((check) => check.state === "fail");
}

export function sumSplits(splits: { percentage: number | string }[] | null | undefined): number | null {
  if (!splits || splits.length === 0) return null;
  return splits.reduce((total, split) => total + Number(split.percentage), 0);
}
