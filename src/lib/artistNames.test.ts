import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isMissingColumn, similarNames } from "./artistNames.ts";

describe("isMissingColumn", () => {
  it("reconnaît une colonne absente", () => {
    assert.equal(isMissingColumn({ code: "42703" }), true);
    assert.equal(isMissingColumn({ code: "PGRST204" }), true);
  });

  it("ne confond pas avec une autre panne", () => {
    assert.equal(isMissingColumn({ code: "42P01" }), false);
    assert.equal(isMissingColumn(null), false);
    assert.equal(isMissingColumn(undefined), false);
  });
});

describe("similarNames", () => {
  it("classe du plus ressemblant au moins ressemblant", () => {
    const names = similarNames([
      { score: 0.41, detail: { matched_name: "Rafal" } },
      { score: "0.82", detail: { matched_name: "Rafale Noire" } },
    ]);
    assert.deepEqual(names, [
      { name: "Rafale Noire", score: 0.82 },
      { name: "Rafal", score: 0.41 },
    ]);
  });

  it("garde le meilleur score d'un nom cité plusieurs fois", () => {
    const names = similarNames([
      { score: 0.5, detail: { matched_name: "Rafal" } },
      { score: 0.7, detail: { matched_name: "Rafal" } },
      { score: null, detail: { matched_name: "Rafal" } },
    ]);
    assert.deepEqual(names, [{ name: "Rafal", score: 0.7 }]);
  });

  it("ignore une ligne sans nom lisible, et tolère un score absent", () => {
    const names = similarNames([
      { score: 0.6, detail: null },
      { score: 0.6, detail: { matched_name: "  " } },
      { score: null, detail: { matched_name: "Sans score" } },
    ]);
    assert.deepEqual(names, [{ name: "Sans score", score: null }]);
  });
});
