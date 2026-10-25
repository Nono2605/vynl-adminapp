import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { describeScan, isMissingTable, needsReview } from "./scans.ts";

describe("describeScan", () => {
  it("un fichier identique : refus à l'envoi", () => {
    const text = describeScan({ check_kind: "file_hash", score: 1, detail: { blocked_upload: true } });
    assert.match(text.title, /Same audio file/);
    assert.match(text.text, /refused/);
  });

  it("un nom proche : cite le nom trouvé et la similarité", () => {
    const text = describeScan({ check_kind: "name_similarity", score: "0.7345", detail: { matched_name: "Daft Punk" } });
    assert.match(text.text, /“Daft Punk”/);
    assert.match(text.text, /similarity 0\.73/);
  });

  it("un nom proche sans détail ni score : reste lisible", () => {
    const text = describeScan({ check_kind: "name_similarity", score: null, detail: null });
    assert.match(text.text, /another artist/);
    assert.doesNotMatch(text.text, /similarity/);
  });

  it("une sorte de contrôle inconnue reste affichée telle quelle", () => {
    const text = describeScan({ check_kind: "acoustic_fingerprint", score: null, detail: {} });
    assert.equal(text.title, "acoustic fingerprint");
    assert.equal(text.text, "");
  });
});

describe("needsReview", () => {
  it("à relire : un avertissement ou un échec sans décision", () => {
    assert.equal(needsReview({ result: "warn", decision: null }), true);
    assert.equal(needsReview({ result: "fail", decision: null }), true);
  });
  it("rien à relire : ok, ou déjà tranché", () => {
    assert.equal(needsReview({ result: "ok", decision: null }), false);
    assert.equal(needsReview({ result: "warn", decision: "dismissed" }), false);
    assert.equal(needsReview({ result: "fail", decision: "confirmed" }), false);
  });
});

describe("describeScan : fichier bloqué", () => {
  it("dit que le fichier est sur la liste de blocage, sans parler d'un artiste ni d'un signalement précis", () => {
    const described = describeScan({ check_kind: "blocked_file", score: 1, detail: { reason: "blocklist" } });
    assert.equal(described.title, "File on the block list");
    assert.match(described.text, /rights holder claim/);
  });
});

describe("isMissingTable", () => {
  it("reconnaît une table absente, pas les autres erreurs", () => {
    assert.equal(isMissingTable({ code: "42P01" }), true);
    assert.equal(isMissingTable({ code: "PGRST205" }), true);
    assert.equal(isMissingTable({ code: "42501" }), false);
    assert.equal(isMissingTable(null), false);
  });
});
