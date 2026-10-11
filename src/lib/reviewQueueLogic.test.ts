import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { nextAfter, positionOf } from "./reviewQueueLogic.ts";

describe("nextAfter", () => {
  it("file vide : rien à ouvrir", () => {
    assert.equal(nextAfter([]), null);
    assert.equal(nextAfter([], "a"), null);
  });

  it("sans élément courant : le plus ancien", () => {
    assert.equal(nextAfter(["a", "b", "c"]), "a");
  });

  it("on saute un élément : celui d'après", () => {
    assert.equal(nextAfter(["a", "b", "c"], "a"), "b");
    assert.equal(nextAfter(["a", "b", "c"], "b"), "c");
  });

  it("on saute le dernier : on boucle sur le plus ancien des autres", () => {
    assert.equal(nextAfter(["a", "b", "c"], "c"), "a");
  });

  it("un seul élément et on le saute : rien d'autre à ouvrir", () => {
    assert.equal(nextAfter(["a"], "a"), null);
  });

  it("l'élément courant vient d'être décidé (absent de la file) : le plus ancien restant", () => {
    assert.equal(nextAfter(["b", "c"], "a"), "b");
  });

  it("l'élément décidé était le dernier : file vide, on a fini", () => {
    assert.equal(nextAfter([], "a"), null);
  });
});

describe("positionOf", () => {
  it("rang à partir de 1", () => {
    assert.equal(positionOf(["a", "b", "c"], "a"), 1);
    assert.equal(positionOf(["a", "b", "c"], "c"), 3);
  });

  it("absent de la file : null", () => {
    assert.equal(positionOf(["a", "b"], "z"), null);
  });
});
