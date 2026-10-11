import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatDuration, formatListening, formatMoney, formatShare } from "./format.ts";

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

describe("formatMoney", () => {
  it("centimes + devise en minuscules", () => {
    assert.match(formatMoney(1000, "chf"), /CHF\s?10\.00/);
    assert.match(formatMoney(75, "chf"), /CHF\s?0\.75/);
    assert.match(formatMoney(123456, "eur"), /€\s?1,234\.56/);
  });
  it("une devise inconnue ne plante pas", () => {
    assert.equal(formatMoney(1000, "zz"), "10.00 ZZ");
  });
});
