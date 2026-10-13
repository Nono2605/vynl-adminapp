import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ACCEPTED_PROVENANCES,
  blockers,
  declarationState,
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
