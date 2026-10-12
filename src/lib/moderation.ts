// Règles de la revue d'un morceau, en fonctions pures : la même liste de
// contrôles sert à l'affichage (fiche du morceau, file de modération) ET à la
// vérification faite côté serveur avant de publier. Un bouton grisé n'est
// jamais la seule barrière.
//
// Le futur scan audio (détection de plagiat / droits d'auteur) s'ajoutera ici
// comme un contrôle de plus, avec le même état « ok / warn / fail » : un « fail »
// bloque la publication.

// Provenances acceptées pendant la bêta (décision du 12 oct. 2026) : la plateforme est 100 % IA.
// Un morceau déclaré « hybrid » est ENREGISTRÉ mais en attente (« held ») : il ne se publie pas
// tant qu'on n'ouvre pas l'hybride. Changer cette liste est un changement de code, relu et testé,
// pas un simple réglage : c'est une décision juridique (spec, section 15).
export const ACCEPTED_PROVENANCES: readonly string[] = ["ai"];

// Dernière déclaration IA du morceau :
//  - « ai »       : déclaré 100 % IA, accepté ;
//  - « held »     : déclaré autrement (hybrid, ou ancien « human ») : en attente ;
//  - « none »     : aucune déclaration ;
//  - « rejected » : un administrateur a écarté la déclaration.
export type DeclarationState = "none" | "ai" | "held" | "rejected";
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

// Une déclaration écartée par un administrateur (« rejected ») l'emporte ; sinon la provenance
// décide (le statut « pending_review » / « approved » des anciennes déclarations ne compte pas).
// Une provenance absente ou inconnue est traitée comme « held » : en cas de doute, on ne publie pas.
export function declarationState(
  latest: { status: string; provenance?: string | null } | null | undefined
): DeclarationState {
  if (!latest) return "none";
  if (latest.status === "rejected") return "rejected";
  return latest.provenance && ACCEPTED_PROVENANCES.includes(latest.provenance) ? "ai" : "held";
}

// Décisions de produit :
//  - 11 oct. 2026 : la déclaration IA n'a PAS à être relue par un administrateur pour publier.
//  - 12 oct. 2026 : la bêta est 100 % IA. Seul un morceau déclaré « ai » se publie ; un morceau
//    déclaré « hybrid » est en attente ; un morceau SANS déclaration ne se publie pas non plus
//    (on ne sait pas ce qu'il est : avant, ce n'était qu'un avertissement).
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
    ai: { key: "declaration", label: "AI declaration", state: "ok", detail: "Declared as AI-generated (no review needed to publish)" },
    held: {
      key: "declaration",
      label: "AI declaration",
      state: "fail",
      detail: "Held: not declared as AI-generated. The beta accepts AI-generated music only; the track stays saved until other music is opened",
    },
    none: {
      key: "declaration",
      label: "AI declaration",
      state: "fail",
      detail: "No declaration: the beta publishes tracks declared as AI-generated only",
    },
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
