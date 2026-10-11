import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { describeFilters, filterParams, parseFilters } from "./analyticsFilters.ts";

// Mardi 6 octobre 2026, 15:30 UTC.
const now = new Date("2026-10-06T15:30:00Z");
const iso = (date: Date) => date.toISOString();

describe("période prédéfinie", () => {
  it("par défaut : 30 jours, aujourd'hui inclus, borne haute = demain 00:00 UTC", () => {
    const f = parseFilters({}, now);
    assert.equal(iso(f.from), "2026-09-07T00:00:00.000Z");
    assert.equal(iso(f.to), "2026-10-07T00:00:00.000Z");
    assert.equal(f.label, "Last 30 days");
    assert.equal(f.preset, "30d");
  });

  it("7 et 90 jours", () => {
    assert.equal(iso(parseFilters({ range: "7d" }, now).from), "2026-09-30T00:00:00.000Z");
    assert.equal(iso(parseFilters({ range: "90d" }, now).from), "2026-07-09T00:00:00.000Z");
  });

  it("une valeur inconnue retombe sur 30 jours", () => {
    assert.equal(parseFilters({ range: "forever" }, now).preset, "30d");
  });
});

describe("période personnalisée", () => {
  it("les dates saisies l'emportent ; la date de fin est incluse", () => {
    const f = parseFilters({ from: "2026-10-01", to: "2026-10-03", range: "7d" }, now);
    assert.equal(iso(f.from), "2026-10-01T00:00:00.000Z");
    assert.equal(iso(f.to), "2026-10-04T00:00:00.000Z");
    assert.equal(f.preset, null);
    assert.equal(f.label, "2026-10-01 to 2026-10-03");
    assert.equal(f.warning, undefined);
  });

  it("un seul jour", () => {
    const f = parseFilters({ from: "2026-10-02", to: "2026-10-02" }, now);
    assert.equal(f.label, "2026-10-02");
    assert.equal(iso(f.to), "2026-10-03T00:00:00.000Z");
  });

  it("dates incomplètes, impossibles ou inversées : ignorées avec un avertissement", () => {
    for (const params of [{ from: "2026-10-01" }, { from: "2026-02-31", to: "2026-03-01" }, { from: "2026-10-05", to: "2026-10-01" }, { from: "hier", to: "demain" }]) {
      const f = parseFilters(params, now);
      assert.equal(f.preset, "30d", JSON.stringify(params));
      assert.ok(f.warning, JSON.stringify(params));
    }
  });

  it("limitée à 366 jours", () => {
    const f = parseFilters({ from: "2024-01-01", to: "2026-01-01" }, now);
    assert.equal(f.preset, "30d");
    assert.ok(f.warning?.includes("366"));
  });
});

describe("région, pays, appareil, plan", () => {
  it("une région se résout en liste de pays", () => {
    const f = parseFilters({ region: "eu" }, now);
    assert.equal(f.region, "eu");
    assert.equal(f.countries?.length, 27);
  });

  it("un pays précis l'emporte sur la région, en majuscules", () => {
    const f = parseFilters({ region: "eu", country: "ch" }, now);
    assert.deepEqual(f.countries, ["CH"]);
    assert.equal(f.country, "CH");
  });

  it("valeurs invalides ignorées : jamais transmises à la base", () => {
    const f = parseFilters({ region: "atlantis", country: "FRA", device: "toaster", plan: "gold" }, now);
    assert.equal(f.countries, null);
    assert.equal(f.region, "");
    assert.equal(f.country, "");
    assert.equal(f.device, "");
    assert.equal(f.plan, "");
  });

  it("appareil et plan valides conservés", () => {
    const f = parseFilters({ device: "mobile", plan: "free_ad_supported" }, now);
    assert.equal(f.device, "mobile");
    assert.equal(f.plan, "free_ad_supported");
  });

  it("injection dans un paramètre : rejetée", () => {
    const f = parseFilters({ country: "CH'; drop table plays;--", device: "mobile' or '1'='1" }, now);
    assert.equal(f.country, "");
    assert.equal(f.device, "");
  });
});

describe("liens et résumé", () => {
  it("filterParams reproduit les filtres actifs, rien d'autre", () => {
    const f = parseFilters({ range: "7d", region: "europe", device: "mobile" }, now);
    assert.deepEqual(filterParams(f), {
      range: "7d",
      from: undefined,
      to: undefined,
      region: "europe",
      country: undefined,
      device: "mobile",
      plan: undefined,
    });
  });

  it("describeFilters résume la vue", () => {
    assert.equal(describeFilters(parseFilters({}, now)), "Last 30 days");
    assert.equal(
      describeFilters(parseFilters({ range: "7d", region: "eu", device: "mobile", plan: "free_ad_supported" }, now)),
      "Last 7 days · European Union · mobile · free ad supported"
    );
  });
});
