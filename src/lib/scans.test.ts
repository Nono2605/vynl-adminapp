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

describe("describeScan : les contrôles automatiques de l'envoi en relecture", () => {
  it("même fichier chez un autre artiste", () => {
    const described = describeScan({ check_kind: "duplicate_audio", score: null, detail: {} });
    assert.equal(described.title, "Same audio file as another artist's track");
    assert.match(described.text, /identical, byte for byte/);
  });

  it("fichier de la liste de blocage, trouvé à la relecture", () => {
    assert.equal(describeScan({ check_kind: "blocked_audio", score: null, detail: {} }).title, "File on the block list");
  });

  it("même titre et même durée : laisse la décision à l'administrateur", () => {
    const described = describeScan({ check_kind: "similar_title", score: null, detail: { found: 2 } });
    assert.equal(described.title, "Same title and length as another artist's track");
    assert.match(described.text, /up to you/);
  });

  it("un contrôle qui n'a pas pu répondre n'est jamais présenté comme « rien à signaler »", () => {
    const described = describeScan({ check_kind: "fingerprint", score: null, detail: { unavailable: true } });
    assert.equal(described.title, "fingerprint: could not run");
    assert.match(described.text, /did not answer/);
  });
});

describe("describeScan : un résultat « ok » ne décrit jamais une alerte", () => {
  for (const kind of ["duplicate_audio", "blocked_audio", "similar_title"]) {
    it(`${kind} : « ok » dit qu'il n'y a rien, sans le texte de l'alerte`, () => {
      const described = describeScan({ check_kind: kind, score: null, detail: {}, result: "ok" });
      assert.match(described.text, /^(No |The file is not)/);
      assert.doesNotMatch(described.text, /byte for byte|Likely a copy|Listen to both/);
    });
  }

  it("les titres restent ceux du contrôle", () => {
    assert.equal(describeScan({ check_kind: "duplicate_audio", score: null, detail: {}, result: "ok" }).title, "Same audio file as another artist's track");
  });

  it("un contrôle indisponible l'emporte sur « ok » et dit pourquoi", () => {
    const described = describeScan({ check_kind: "fingerprint", score: null, detail: { unavailable: true, message: "monthly request cap reached (300 of 300 used)" }, result: "warn" });
    assert.match(described.title, /could not run/);
    assert.match(described.text, /monthly request cap reached/);
  });
});

describe("describeScan : empreinte acoustique (ACRCloud)", () => {
  const found = {
    samples: [44, 94, 144],
    matches: [
      { title: "Drawing", artists: ["Anyma"], score: 92, seen_at_seconds: [44, 94] },
      { title: "Other", artists: ["X"], score: 70, seen_at_seconds: [144] },
    ],
  };

  it("une reconnaissance : le titre, l'artiste, le score, où elle a été entendue, et d'écouter les deux", () => {
    const described = describeScan({ check_kind: "fingerprint", score: 92, detail: found, result: "warn" });
    assert.equal(described.title, "Known recordings (audio fingerprint)");
    assert.match(described.text, /Looks like “Drawing” by Anyma \(score 92, heard at 44s, 94s\)/);
    assert.match(described.text, /and 1 other/);
    assert.match(described.text, /Listen to both/);
  });

  it("rien de reconnu : ok, avec le nombre d'extraits", () => {
    const described = describeScan({ check_kind: "fingerprint", score: null, detail: { samples: [4, 14, 24], matches: [] }, result: "ok" });
    assert.equal(described.text, "No known recording recognised in 3 samples.");
  });

  it("un indice faible sous le seuil : ok, le score du plus faible est dit", () => {
    const described = describeScan({ check_kind: "fingerprint", score: 40, detail: { samples: [4], matches: [{ title: "Hint", artists: [], score: 40 }] }, result: "ok" });
    assert.match(described.text, /No known recording recognised in 1 sample\./);
    assert.match(described.text, /weakest hint scored 40/);
  });

  it("un résultat repris d'un contrôle précédent le dit", () => {
    const described = describeScan({ check_kind: "fingerprint", score: 92, detail: { ...found, reused: true }, result: "warn" });
    assert.match(described.text, /reused from an earlier check/);
  });
});
