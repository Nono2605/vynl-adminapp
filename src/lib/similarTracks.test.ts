import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { escapeLike, findSimilarTracks, normalizeTitle, type TrackLite } from "./similarTracks.ts";

const track = (over: Partial<TrackLite> = {}): TrackLite => ({ id: "t1", title: "Soleil d'été", duration_seconds: 200, artist_id: "a1", ...over });

describe("normalizeTitle", () => {
  it("ignore la casse, les accents, la ponctuation et les espaces en trop", () => {
    assert.equal(normalizeTitle("  Soleil  d'ÉTÉ !"), "soleil d ete");
    assert.equal(normalizeTitle("Soleil d’été"), normalizeTitle("soleil d'ete"));
  });

  it("garde les lettres non latines et les chiffres", () => {
    assert.equal(normalizeTitle("Интро 2"), "интро 2");
  });
});

describe("findSimilarTracks", () => {
  it("trouve le même titre, d'un autre artiste, à 2 secondes près", () => {
    const found = findSimilarTracks(track(), [track({ id: "t2", artist_id: "a2", title: "SOLEIL D'ETE", duration_seconds: 202 })]);
    assert.deepEqual(found.map((t) => t.id), ["t2"]);
  });

  it("3 secondes d'écart : pas similaire", () => {
    assert.equal(findSimilarTracks(track(), [track({ id: "t2", artist_id: "a2", duration_seconds: 203 })]).length, 0);
  });

  it("le même artiste n'est pas concerné (un single puis l'album)", () => {
    assert.equal(findSimilarTracks(track(), [track({ id: "t2", artist_id: "a1" })]).length, 0);
  });

  it("le morceau lui-même n'est jamais rendu", () => {
    assert.equal(findSimilarTracks(track(), [track({ artist_id: "a2" })]).length, 0);
  });

  it("un autre titre : pas similaire", () => {
    assert.equal(findSimilarTracks(track(), [track({ id: "t2", artist_id: "a2", title: "Soleil" })]).length, 0);
  });

  it("sans durée connue, aucun contrôle", () => {
    assert.equal(findSimilarTracks(track({ duration_seconds: null }), [track({ id: "t2", artist_id: "a2" })]).length, 0);
    assert.equal(findSimilarTracks(track(), [track({ id: "t2", artist_id: "a2", duration_seconds: null })]).length, 0);
  });

  it("un titre sans lettre ni chiffre ne rapproche rien", () => {
    assert.equal(findSimilarTracks(track({ title: "???" }), [track({ id: "t2", artist_id: "a2", title: "!!!" })]).length, 0);
  });
});

describe("escapeLike", () => {
  it("échappe les jokers", () => {
    assert.equal(escapeLike("100%_vrai\\"), "100\\%\\_vrai\\\\");
  });
});
