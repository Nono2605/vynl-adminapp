import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ALL_COUNTRY_CODES,
  EU_COUNTRIES,
  REGION_OPTIONS,
  countriesInRegion,
  countryName,
  isEuMember,
  regionLabel,
  regionOf,
} from "./geo.ts";

const names = new Intl.DisplayNames(["en"], { type: "region", fallback: "none" });

describe("tableau pays → régions", () => {
  it("chaque code est une paire de lettres majuscules, sans doublon", () => {
    assert.equal(new Set(ALL_COUNTRY_CODES).size, ALL_COUNTRY_CODES.length);
    for (const code of ALL_COUNTRY_CODES) assert.match(code, /^[A-Z]{2}$/, code);
  });

  it("couvre à peu près les ~250 territoires de l'ISO 3166-1", () => {
    assert.ok(ALL_COUNTRY_CODES.length >= 245 && ALL_COUNTRY_CODES.length <= 255, String(ALL_COUNTRY_CODES.length));
  });

  it("chaque code est un vrai territoire (une faute de frappe n'a pas de nom)", () => {
    const unknown = ALL_COUNTRY_CODES.filter((code) => names.of(code) === undefined);
    assert.deepEqual(unknown, []);
  });

  it("les pays de référence sont dans la bonne région", () => {
    assert.deepEqual(regionOf("CH"), { continent: "Europe", subregion: "Western Europe" });
    assert.deepEqual(regionOf("FR"), { continent: "Europe", subregion: "Western Europe" });
    assert.deepEqual(regionOf("GB"), { continent: "Europe", subregion: "Northern Europe" });
    assert.deepEqual(regionOf("US"), { continent: "Americas", subregion: "Northern America" });
    assert.deepEqual(regionOf("BR"), { continent: "Americas", subregion: "South America" });
    assert.deepEqual(regionOf("JP"), { continent: "Asia", subregion: "Eastern Asia" });
    assert.deepEqual(regionOf("AU"), { continent: "Oceania", subregion: "Australia and New Zealand" });
    assert.deepEqual(regionOf("ZA"), { continent: "Africa", subregion: "Southern Africa" });
  });

  it("un code inconnu n'est pas classé au hasard", () => {
    assert.deepEqual(regionOf("ZZ"), { continent: "Unknown", subregion: "Unknown" });
    assert.deepEqual(regionOf("unknown"), { continent: "Unknown", subregion: "Unknown" });
  });
});

describe("Union européenne", () => {
  it("27 États, tous dans le tableau", () => {
    assert.equal(EU_COUNTRIES.length, 27);
    assert.equal(new Set(EU_COUNTRIES).size, 27);
    for (const code of EU_COUNTRIES) assert.ok(ALL_COUNTRY_CODES.includes(code), code);
  });

  it("tous en Europe, sauf Chypre : l'ONU la classe en Asie occidentale, le filtre UE l'inclut quand même", () => {
    for (const code of EU_COUNTRIES.filter((c) => c !== "CY")) assert.equal(regionOf(code).continent, "Europe", code);
    assert.equal(regionOf("CY").continent, "Asia");
    assert.ok(countriesInRegion("eu")!.includes("CY"));
  });

  it("la Suisse, le Royaume-Uni et la Norvège n'en font pas partie", () => {
    assert.equal(isEuMember("CH"), false);
    assert.equal(isEuMember("GB"), false);
    assert.equal(isEuMember("NO"), false);
    assert.equal(isEuMember("DE"), true);
  });
});

describe("filtre région", () => {
  it("« eu » et « ch » renvoient leurs pays", () => {
    assert.equal(countriesInRegion("eu")?.length, 27);
    assert.deepEqual(countriesInRegion("ch"), ["CH"]);
  });

  it("un continent contient ses pays et seulement eux", () => {
    const europe = countriesInRegion("europe")!;
    assert.ok(europe.includes("CH") && europe.includes("GB") && europe.includes("FR"));
    assert.ok(!europe.includes("US"));
    for (const code of europe) assert.equal(regionOf(code).continent, "Europe");
  });

  it("une sous-région se retrouve par son identifiant", () => {
    const western = countriesInRegion("western-europe")!;
    assert.deepEqual([...western].sort(), ["AT", "BE", "CH", "DE", "FR", "LI", "LU", "MC", "NL"]);
    assert.ok(countriesInRegion("northern-america")!.includes("US"));
  });

  it("les continents recouvrent tous les pays, sans recouvrement", () => {
    const continents = ["africa", "americas", "asia", "europe", "oceania"];
    const all = continents.flatMap((id) => countriesInRegion(id)!);
    // L'Antarctique (AQ) n'a pas de filtre : tout le reste est classé une seule fois.
    assert.equal(all.length, ALL_COUNTRY_CODES.length - 1);
    assert.equal(new Set(all).size, all.length);
  });

  it("un identifiant inconnu ne filtre rien (null) et n'a pas de libellé", () => {
    assert.equal(countriesInRegion("atlantis"), null);
    assert.equal(regionLabel("atlantis"), null);
  });

  it("chaque option proposée dans l'interface renvoie des pays", () => {
    for (const option of REGION_OPTIONS) {
      const countries = countriesInRegion(option.id);
      assert.ok(countries && countries.length > 0, option.id);
    }
  });

  it("les identifiants d'options sont uniques", () => {
    const ids = REGION_OPTIONS.map((option) => option.id);
    assert.equal(new Set(ids).size, ids.length);
  });
});

describe("noms de pays", () => {
  it("noms lisibles, « Unknown » pour un pays non déterminé", () => {
    assert.equal(countryName("CH"), "Switzerland");
    assert.equal(countryName("unknown"), "Unknown");
    // Un code qu'aucune norme ne connaît reste affiché tel quel.
    assert.equal(countryName("QQ"), "QQ");
  });
});
