import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { csvCell, toCsv } from "./csv.ts";

describe("csvCell", () => {
  it("texte simple, nombres et valeurs vides", () => {
    assert.equal(csvCell("Alpha"), "Alpha");
    assert.equal(csvCell(42), "42");
    assert.equal(csvCell(3.5), "3.5");
    assert.equal(csvCell(null), "");
    assert.equal(csvCell(undefined), "");
    assert.equal(csvCell(Number.NaN), "");
  });

  it("virgule, guillemet et retour à la ligne : entre guillemets, guillemets doublés", () => {
    assert.equal(csvCell("Smith, John"), '"Smith, John"');
    assert.equal(csvCell('The "Best" Band'), '"The ""Best"" Band"');
    assert.equal(csvCell("two\nlines"), '"two\nlines"');
  });

  it("un texte qui ressemble à une formule est neutralisé", () => {
    assert.equal(csvCell("=HYPERLINK(\"http://evil\",\"x\")"), `"'=HYPERLINK(""http://evil"",""x"")"`);
    assert.equal(csvCell("+1+1"), "'+1+1");
    assert.equal(csvCell("-2+3"), "'-2+3");
    assert.equal(csvCell("@SUM(A1)"), "'@SUM(A1)");
  });

  it("un nombre négatif reste un nombre (pas une formule)", () => {
    assert.equal(csvCell(-5), "-5");
  });
});

describe("toCsv", () => {
  it("en-têtes puis lignes, séparées par CRLF, avec un saut final", () => {
    assert.equal(toCsv(["artist", "plays"], [["Alpha", 3], ["B, C", 1]]), 'artist,plays\r\nAlpha,3\r\n"B, C",1\r\n');
  });

  it("sans ligne : seulement les en-têtes", () => {
    assert.equal(toCsv(["a", "b"], []), "a,b\r\n");
  });
});
