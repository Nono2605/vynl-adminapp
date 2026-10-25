import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ACCEPTED_PROVENANCES,
  blockers,
  declarationState,
  scansCheck,
  sumSplits,
  trackChecks,
  type TrackCheckInput,
} from "./moderation.ts";

// Un morceau en bon état : audio, durée, déclaré 100 % IA, pas de répartition. Chaque test n'en change qu'un point.
const ready: TrackCheckInput = { durationSeconds: 215, fileCount: 1, declaration: "ai", splitsTotal: null };
const blocking = (overrides: Partial<TrackCheckInput>) => blockers(trackChecks({ ...ready, ...overrides })).map((c) => c.key);
const declarationCheck = (declaration: TrackCheckInput["declaration"]) =>
  trackChecks({ ...ready, declaration }).find((c) => c.key === "declaration")!;

describe("publication : la bêta est 100 % IA (décision du 12 oct. 2026)", () => {
  it("un morceau déclaré « ai » se publie, sans relecture de la déclaration", () => {
    assert.deepEqual(blocking({ declaration: "ai" }), []);
    assert.equal(declarationCheck("ai").state, "ok");
  });
  it("un morceau déclaré « hybrid » est EN ATTENTE : il bloque la publication", () => {
    assert.deepEqual(blocking({ declaration: "held" }), ["declaration"]);
    const check = declarationCheck("held");
    assert.equal(check.state, "fail");
    assert.match(check.detail, /Held/);
  });
  it("sans déclaration, un morceau ne se publie pas non plus", () => {
    assert.deepEqual(blocking({ declaration: "none" }), ["declaration"]);
    assert.equal(declarationCheck("none").state, "fail");
  });
  it("déclaration REFUSÉE par un administrateur : bloque toujours (décision explicite)", () => {
    assert.deepEqual(blocking({ declaration: "rejected" }), ["declaration"]);
  });
  it("seule la provenance « ai » est acceptée", () => {
    assert.deepEqual([...ACCEPTED_PROVENANCES], ["ai"]);
  });
});

describe("genre : jamais bloquant, seulement signalé", () => {
  const genreCheck = (genre: TrackCheckInput["genre"]) =>
    trackChecks({ ...ready, genre }).find((c) => c.key === "genre");

  it("un genre choisi : ok", () => {
    assert.equal(genreCheck("pop")?.state, "ok");
  });
  it("sans genre : avertissement, la publication n'est pas bloquée", () => {
    assert.equal(genreCheck(null)?.state, "warn");
    assert.deepEqual(blocking({ genre: null }), []);
    assert.deepEqual(blocking({ genre: "" }), []);
  });
  it("genre illisible (migration pas appliquée) : aucun contrôle de genre", () => {
    assert.equal(genreCheck(undefined), undefined);
    assert.deepEqual(blocking({}), []);
  });
});

describe("publication : les autres contrôles restent bloquants", () => {
  it("sans fichier audio", () => assert.deepEqual(blocking({ fileCount: 0 }), ["audio"]));
  it("sans durée mesurée", () => {
    assert.deepEqual(blocking({ durationSeconds: null }), ["duration"]);
    assert.deepEqual(blocking({ durationSeconds: 0 }), ["duration"]);
  });
  it("répartitions qui ne font pas 100 %", () => assert.deepEqual(blocking({ splitsTotal: 90 }), ["splits"]));
  it("répartitions à 100 % : ok", () => assert.deepEqual(blocking({ splitsTotal: 100 }), []));
  it("une déclaration valide ne masque pas un autre problème", () => {
    assert.deepEqual(blocking({ declaration: "ai", fileCount: 0 }), ["audio"]);
  });
  it("plusieurs problèmes sont tous signalés", () => {
    assert.deepEqual(blocking({ declaration: "held", fileCount: 0 }), ["audio", "declaration"]);
  });
});

describe("declarationState", () => {
  it("aucune déclaration : none", () => {
    assert.equal(declarationState(null), "none");
    assert.equal(declarationState(undefined), "none");
  });
  it("provenance « ai » : ai, quel que soit l'ancien statut de la déclaration", () => {
    assert.equal(declarationState({ status: "declared", provenance: "ai" }), "ai");
    assert.equal(declarationState({ status: "pending_review", provenance: "ai" }), "ai");
    assert.equal(declarationState({ status: "approved", provenance: "ai" }), "ai");
  });
  it("hybrid, et l'ancien human : en attente", () => {
    assert.equal(declarationState({ status: "declared", provenance: "hybrid" }), "held");
    assert.equal(declarationState({ status: "declared", provenance: "human" }), "held");
  });
  it("provenance absente ou inconnue : en attente (dans le doute, on ne publie pas)", () => {
    assert.equal(declarationState({ status: "declared" }), "held");
    assert.equal(declarationState({ status: "declared", provenance: null }), "held");
    assert.equal(declarationState({ status: "declared", provenance: "AI" }), "held");
    assert.equal(declarationState({ status: "declared", provenance: "other" }), "held");
  });
  it("une déclaration REFUSÉE l'emporte sur la provenance", () => {
    assert.equal(declarationState({ status: "rejected", provenance: "ai" }), "rejected");
    assert.equal(declarationState({ status: "rejected", provenance: "hybrid" }), "rejected");
  });
});

describe("sumSplits", () => {
  it("somme des parts, null s'il n'y en a pas", () => {
    assert.equal(sumSplits(null), null);
    assert.equal(sumSplits([]), null);
    assert.equal(sumSplits([{ percentage: "60" }, { percentage: 40 }]), 100);
  });
});

describe("morceau similaire d'un autre artiste (spec 15.5, D4)", () => {
  const similar = (similarTitleCount?: number) => trackChecks({ ...ready, similarTitleCount }).find((c) => c.key === "similar_title");

  it("pas cherché : aucun contrôle affiché", () => {
    assert.equal(similar(undefined), undefined);
  });

  it("aucun morceau similaire : ok", () => {
    assert.equal(similar(0)?.state, "ok");
  });

  it("un ou plusieurs morceaux similaires : un avertissement, au singulier ou au pluriel", () => {
    assert.equal(similar(1)?.state, "warn");
    assert.match(similar(1)!.detail, /^1 track by other artists/);
    assert.match(similar(3)!.detail, /^3 tracks by other artists/);
  });

  it("un avertissement ne bloque JAMAIS la publication : la relecture humaine tranche", () => {
    assert.deepEqual(blocking({ similarTitleCount: 5 }), []);
  });
});

describe("contrôles automatiques : un seul contrôle « scans » qui résume le journal", () => {
  const done = { state: "done" as const, failing: 0, confirmed: 0, warning: 0, unavailable: 0, checks: 3 };
  const scans = (overrides: Partial<typeof done>) => ({ ...done, ...overrides });
  const scansLine = (summary: Parameters<typeof scansCheck>[0]) => scansCheck(summary);

  it("sans résumé (migration de la file pas appliquée), aucun contrôle n'est ajouté", () => {
    assert.equal(trackChecks({ ...ready }).find((c) => c.key === "scans"), undefined);
    assert.deepEqual(blocking({}), []);
  });

  it("rien à signaler : ok, et la publication n'est pas bloquée", () => {
    const check = scansLine(done);
    assert.equal(check.state, "ok");
    assert.match(check.detail, /3 checks run/);
    assert.deepEqual(blocking({ scans: done }), []);
  });

  it("en cours : BLOQUE la publication (on ne publie pas avant le résultat)", () => {
    assert.deepEqual(blocking({ scans: { ...done, state: "pending", checks: 0 } }), ["scans"]);
  });

  it("une alerte grave non tranchée bloque ; une fois écartée (failing = 0), elle ne bloque plus", () => {
    assert.deepEqual(blocking({ scans: scans({ failing: 1 }) }), ["scans"]);
    assert.match(scansLine(scans({ failing: 2 })).detail, /2 serious alerts to settle/);
    assert.deepEqual(blocking({ scans: scans({ failing: 0 }) }), []);
  });

  it("un problème confirmé bloque et dit de refuser", () => {
    const check = scansLine(scans({ failing: 1, confirmed: 1 }));
    assert.equal(check.state, "fail");
    assert.match(check.detail, /refuse or archive/);
  });

  it("un avertissement, un contrôle sans réponse, jamais lancé ou tombé en panne : visibles, mais ne bloquent pas", () => {
    for (const summary of [
      scans({ warning: 1 }),
      scans({ unavailable: 1 }),
      { ...done, state: "none" as const, checks: 0 },
      { ...done, state: "unavailable" as const, checks: 0 },
    ]) {
      assert.equal(scansLine(summary).state, "warn");
      assert.deepEqual(blocking({ scans: summary }), []);
    }
  });

  it("une alerte grave l'emporte sur un avertissement dans le message", () => {
    assert.equal(scansLine(scans({ failing: 1, warning: 3 })).state, "fail");
  });
});
