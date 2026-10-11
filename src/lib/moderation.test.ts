import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { blockers, declarationState, sumSplits, trackChecks, type TrackCheckInput } from "./moderation.ts";

// Un morceau en bon état : audio, durée, pas de répartition. Chaque test n'en change qu'un point.
const ready: TrackCheckInput = { durationSeconds: 215, fileCount: 1, declaration: "none", splitsTotal: null };
const blocking = (overrides: Partial<TrackCheckInput>) => blockers(trackChecks({ ...ready, ...overrides })).map((c) => c.key);

describe("publication : déclaration IA", () => {
  it("une déclaration du créateur ne bloque pas la publication, sans relecture (décision du 11 oct.)", () => {
    assert.deepEqual(blocking({ declaration: "declared" }), []);
    const check = trackChecks({ ...ready, declaration: "declared" }).find((c) => c.key === "declaration")!;
    assert.equal(check.state, "ok");
  });
  it("sans déclaration : avertissement seulement, pas de blocage", () => {
    assert.deepEqual(blocking({ declaration: "none" }), []);
    const check = trackChecks({ ...ready, declaration: "none" }).find((c) => c.key === "declaration")!;
    assert.equal(check.state, "warn");
  });
  it("déclaration REFUSÉE par un administrateur : bloque toujours (décision explicite)", () => {
    assert.deepEqual(blocking({ declaration: "rejected" }), ["declaration"]);
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
  it("une déclaration ne masque pas un autre problème", () => {
    assert.deepEqual(blocking({ declaration: "declared", fileCount: 0 }), ["audio"]);
  });
});

describe("declarationState / sumSplits", () => {
  it("seul « rejected » compte : tout autre statut est « declared »", () => {
    assert.equal(declarationState(null), "none");
    assert.equal(declarationState({ status: "declared" }), "declared");
    assert.equal(declarationState({ status: "rejected" }), "rejected");
  });
  it("les anciens statuts (avant la migration) comptent comme « declared »", () => {
    assert.equal(declarationState({ status: "pending_review" }), "declared");
    assert.equal(declarationState({ status: "approved" }), "declared");
  });
  it("somme des parts, null s'il n'y en a pas", () => {
    assert.equal(sumSplits(null), null);
    assert.equal(sumSplits([]), null);
    assert.equal(sumSplits([{ percentage: "60" }, { percentage: 40 }]), 100);
  });
});
