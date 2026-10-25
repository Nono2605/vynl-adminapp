import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ageInDays, canTransition, claimReference, extractTrackId, isDecided, isOverdue, repeatArtists } from "./rightsClaims.ts";

const NOW = new Date("2026-10-25T12:00:00Z");

describe("claimReference", () => {
  it("complète à cinq chiffres, comme l'API", () => {
    assert.equal(claimReference(12), "RC-00012");
    assert.equal(claimReference("7"), "RC-00007");
  });
});

describe("transitions", () => {
  it("un signalement reçu peut être examiné ou décidé", () => {
    for (const to of ["in_review", "upheld", "rejected", "withdrawn"] as const) assert.equal(canTransition("received", to), true, to);
  });

  it("un signalement en examen peut être décidé, pas « reçu » à nouveau", () => {
    for (const to of ["upheld", "rejected", "withdrawn"] as const) assert.equal(canTransition("in_review", to), true, to);
    assert.equal(canTransition("in_review", "in_review"), false);
  });

  it("une décision est définitive", () => {
    for (const from of ["upheld", "rejected", "withdrawn"]) {
      for (const to of ["in_review", "upheld", "rejected", "withdrawn"] as const) assert.equal(canTransition(from, to), false, `${from} -> ${to}`);
    }
  });

  it("un état inconnu ne permet rien", () => {
    assert.equal(canTransition("autre", "rejected"), false);
  });

  it("isDecided", () => {
    assert.deepEqual(["received", "in_review", "upheld", "rejected", "withdrawn"].map(isDecided), [false, false, true, true, true]);
  });
});

describe("extractTrackId", () => {
  it("retrouve l'identifiant dans une adresse ou un texte, en minuscules", () => {
    assert.equal(extractTrackId("https://app.vynl.ch/track/0F3C2A10-1B2C-4D3E-8F40-5A6B7C8D9E0F?x=1"), "0f3c2a10-1b2c-4d3e-8f40-5a6b7c8d9e0f");
    assert.equal(extractTrackId("voir 0f3c2a10-1b2c-4d3e-8f40-5a6b7c8d9e0f, merci"), "0f3c2a10-1b2c-4d3e-8f40-5a6b7c8d9e0f");
  });

  it("rend null quand il n'y en a pas (titre et artiste en texte libre)", () => {
    assert.equal(extractTrackId("« Soleil » par Jeanne"), null);
    assert.equal(extractTrackId(""), null);
    assert.equal(extractTrackId("0f3c2a10-1b2c-0d3e-8f40-5a6b7c8d9e0f"), null); // version 0 : pas un identifiant de la base
  });
});

describe("retard", () => {
  it("ageInDays : jours entiers, jamais négatif, date illisible = 0", () => {
    assert.equal(ageInDays("2026-10-25T00:00:00Z", NOW), 0);
    assert.equal(ageInDays("2026-10-22T11:00:00Z", NOW), 3);
    assert.equal(ageInDays("2026-10-30T00:00:00Z", NOW), 0);
    assert.equal(ageInDays("pas une date", NOW), 0);
  });

  it("un signalement OUVERT depuis trois jours est en retard ; un signalement décidé jamais", () => {
    assert.equal(isOverdue({ status: "received", created_at: "2026-10-22T00:00:00Z" }, NOW), true);
    assert.equal(isOverdue({ status: "in_review", created_at: "2026-10-23T11:00:00Z" }, NOW), false);
    assert.equal(isOverdue({ status: "upheld", created_at: "2026-09-01T00:00:00Z" }, NOW), false);
  });
});

describe("repeatArtists", () => {
  it("ne compte que les signalements fondés, à partir de deux", () => {
    const rows = [
      { artist_id: "a", status: "upheld" },
      { artist_id: "a", status: "upheld" },
      { artist_id: "a", status: "rejected" },
      { artist_id: "b", status: "upheld" },
      { artist_id: "c", status: "upheld" },
      { artist_id: "c", status: "upheld" },
      { artist_id: "c", status: "upheld" },
      { artist_id: null, status: "upheld" },
      { artist_id: null, status: "upheld" },
    ];
    assert.deepEqual(repeatArtists(rows), [
      { artist_id: "c", count: 3 },
      { artist_id: "a", count: 2 },
    ]);
  });

  it("le seuil est réglable", () => {
    assert.deepEqual(repeatArtists([{ artist_id: "b", status: "upheld" }], 1), [{ artist_id: "b", count: 1 }]);
  });
});
