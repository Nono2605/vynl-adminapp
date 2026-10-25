// Règles de la revue d'un morceau, en fonctions pures : la même liste de
// contrôles sert à l'affichage (fiche du morceau, file de modération) ET à la
// vérification faite côté serveur avant de publier. Un bouton grisé n'est
// jamais la seule barrière.
//
// Les contrôles automatiques (doublons de fichier, liste de blocage, titre déjà pris ; plus tard
// la reconnaissance acoustique) arrivent ici sous la forme d'UN contrôle, « scans », résumé par
// lib/scanSummary.ts, avec le même état « ok / warn / fail » : un « fail » bloque la publication.

import type { ScanSummary } from "@/lib/scanSummary";

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
  key: "audio" | "duration" | "declaration" | "genre" | "splits" | "similar_title" | "scans";
  label: string;
  state: CheckState;
  detail: string;
}

export interface TrackCheckInput {
  durationSeconds: number | null;
  fileCount: number;
  declaration: DeclarationState;
  // Genre (liste fermée). undefined = on n'a pas pu le lire (migration des genres pas encore appliquée) : pas de contrôle.
  genre?: string | null;
  // Somme des parts (%) si des parts existent, null s'il n'y en a aucune.
  splitsTotal: number | null;
  // Morceaux d'AUTRES artistes de même titre et de durée voisine (spec 15.5, D4). undefined = pas cherché : pas de contrôle.
  similarTitleCount?: number;
  // Résumé des contrôles automatiques (lib/scanSummary.ts). undefined = on n'a pas pu le lire (migration de la file des
  // contrôles pas encore appliquée) : pas de contrôle.
  scans?: ScanSummary;
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

  // Le genre n'empêche pas de publier : sans lui, le morceau manque simplement aux statistiques par style.
  if (input.genre !== undefined) {
    checks.push(
      input.genre
        ? { key: "genre", label: "Genre", state: "ok", detail: "Chosen by the creator" }
        : { key: "genre", label: "Genre", state: "warn", detail: "No genre chosen: the track is missing from the style statistics" }
    );
  }

  // D4 : un simple avertissement pour la relecture (deux œuvres peuvent légitimement partager un titre).
  if (input.similarTitleCount !== undefined) {
    checks.push(
      input.similarTitleCount > 0
        ? {
            key: "similar_title",
            label: "Similar track",
            state: "warn",
            detail: `${input.similarTitleCount} track${input.similarTitleCount > 1 ? "s" : ""} by other artists with the same title and almost the same length: check that this is not a copy`,
          }
        : { key: "similar_title", label: "Similar track", state: "ok", detail: "No track by another artist with the same title and length" }
    );
  }

  if (input.scans) checks.push(scansCheck(input.scans));

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

// Les contrôles automatiques, en une ligne. « En cours » BLOQUE (il serait trompeur de publier avant le résultat) ;
// une alerte grave non tranchée bloque aussi, jusqu'à ce que l'administrateur la confirme ou l'écarte ; un contrôle
// qui n'a pas pu répondre ne bloque pas (une panne de prestataire ne doit pas figer la file) mais se voit.
export function scansCheck(scans: ScanSummary): Check {
  const label = "Automatic checks";
  const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? "s" : ""}`;

  switch (scans.state) {
    case "pending":
      return { key: "scans", label, state: "fail", detail: "Running now: wait a moment, then reload the page" };
    case "none":
      return { key: "scans", label, state: "warn", detail: "Not run yet: use “Run the checks” in Content checks below" };
    case "unavailable":
      return {
        key: "scans",
        label,
        state: "warn",
        detail: "The last run did not finish: run the checks again, or review this track by hand",
      };
    case "done":
      break;
  }

  if (scans.confirmed > 0) {
    return { key: "scans", label, state: "fail", detail: "A problem was confirmed on this track: refuse or archive it" };
  }
  if (scans.failing > 0) {
    return {
      key: "scans",
      label,
      state: "fail",
      detail: `${plural(scans.failing, "serious alert")} to settle in Content checks below: confirm or dismiss ${scans.failing > 1 ? "each" : "it"}`,
    };
  }
  if (scans.unavailable > 0) {
    return { key: "scans", label, state: "warn", detail: `${plural(scans.unavailable, "check")} could not answer: run them again, or review by hand` };
  }
  if (scans.warning > 0) {
    return { key: "scans", label, state: "warn", detail: `${plural(scans.warning, "alert")} to look at in Content checks below` };
  }
  return { key: "scans", label, state: "ok", detail: `${plural(scans.checks, "check")} run, nothing to report` };
}

export function blockers(checks: Check[]): Check[] {
  return checks.filter((check) => check.state === "fail");
}

export function sumSplits(splits: { percentage: number | string }[] | null | undefined): number | null {
  if (!splits || splits.length === 0) return null;
  return splits.reduce((total, split) => total + Number(split.percentage), 0);
}
