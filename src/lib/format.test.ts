import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatDuration, formatListening, formatShare } from "./format.ts";

describe("formatListening", () => {
  it("secondes, minutes, heures", () => {
    assert.equal(formatListening(0), "0 min");
    assert.equal(formatListening(45), "45 s");
    assert.equal(formatListening(720), "12 min");
    assert.equal(formatListening(12600), "3.5 h");
    assert.equal(formatListening(3600), "1 h");
  });
  it("valeur invalide ou négative : 0 min", () => {
    assert.equal(formatListening(Number.NaN), "0 min");
    assert.equal(formatListening(-5), "0 min");
  });
});

describe("formatShare", () => {
  it("pourcentage arrondi à une décimale", () => {
    assert.equal(formatShare(1, 3), "33.3%");
    assert.equal(formatShare(1, 2), "50%");
    assert.equal(formatShare(2, 2), "100%");
  });
  it("total nul : tiret, jamais NaN ni Infinity", () => {
    assert.equal(formatShare(0, 0), "—");
    assert.equal(formatShare(5, 0), "—");
  });
});

describe("formatDuration (existant)", () => {
  it("3:35", () => assert.equal(formatDuration(215), "3:35"));
});
