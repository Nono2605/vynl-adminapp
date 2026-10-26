import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { queueReviewMessage, runPendingMessage, trackScanMessage } from "./scanMessages.ts";

describe("trackScanMessage", () => {
  it("tâche créée : on annonce le départ", () => {
    assert.match(trackScanMessage({ queued: true }), /^Checks started/);
  });
  it("tâche déjà ouverte : on le dit, on n'annonce pas un départ", () => {
    const message = trackScanMessage({ queued: false, reason: "already_open" });
    assert.match(message, /already waiting or running/);
    assert.doesNotMatch(message, /started/);
  });
});

describe("runPendingMessage", () => {
  it("rien en file : on dit que rien n'est parti, et vers quel bouton aller", () => {
    for (const waiting of [0, -1]) {
      const message = runPendingMessage({ started: true, waiting });
      assert.match(message, /Nothing was waiting/);
      assert.match(message, /Check every track in review/);
      assert.doesNotMatch(message, /resumed/i);
    }
  });
  it("des tâches en file : on donne leur nombre, au singulier ou au pluriel", () => {
    assert.match(runPendingMessage({ started: true, waiting: 1 }), /^Resumed: 1 track is waiting/);
    assert.match(runPendingMessage({ started: true, waiting: 3 }), /^Resumed: 3 tracks are waiting/);
  });
});

describe("queueReviewMessage", () => {
  it("aucun morceau en relecture", () => {
    assert.match(queueReviewMessage({ in_review: 0, queued: 0, already_open: 0 }), /No track is waiting/);
  });
  it("tous déjà en file : rien de nouveau n'est annoncé", () => {
    const message = queueReviewMessage({ in_review: 2, queued: 0, already_open: 2 });
    assert.match(message, /All 2 tracks in review already have a check/);
  });
  it("des morceaux mis en file, avec ceux qui l'étaient déjà", () => {
    assert.match(queueReviewMessage({ in_review: 3, queued: 1, already_open: 2 }), /^1 track queued for checks, 2 already had one/);
    assert.match(queueReviewMessage({ in_review: 2, queued: 2, already_open: 0 }), /^2 tracks queued for checks\./);
  });
});
