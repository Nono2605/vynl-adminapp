import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { creditRoleLabel } from "./trackCredits.ts";

describe("creditRoleLabel", () => {
  it("écrit les rôles connus en toutes lettres", () => {
    assert.equal(creditRoleLabel("featured"), "Featured");
    assert.equal(creditRoleLabel("producer"), "Producer");
    assert.equal(creditRoleLabel("writer"), "Writer");
  });

  it("garde lisible un rôle inconnu", () => {
    assert.equal(creditRoleLabel("mixing_engineer"), "mixing engineer");
  });
});
