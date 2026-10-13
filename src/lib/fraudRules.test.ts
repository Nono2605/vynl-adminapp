import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { FRAUD_RULES, describeFraudEvent, excludedCount, isExcludable, ruleFor, summarizeDetection } from "./fraudRules.ts";

describe("règles", () => {
  it("six règles, chacune avec un type unique et un texte", () => {
    assert.equal(FRAUD_RULES.length, 6);
    assert.equal(new Set(FRAUD_RULES.map((rule) => rule.type)).size, 6);
    for (const rule of FRAUD_RULES) {
      assert.ok(rule.title.length > 3 && rule.what.length > 10, rule.type);
    }
  });

  it("seul « many_countries » n'est jamais exclu d'un geste", () => {
    assert.deepEqual(FRAUD_RULES.filter((rule) => !rule.excludable).map((rule) => rule.type), ["many_countries"]);
    assert.equal(isExcludable("round_the_clock"), true);
    assert.equal(isExcludable("many_countries"), false);
  });

  it("un type inconnu (événement saisi à la main) n'est pas excluable et n'a pas de règle", () => {
    assert.equal(isExcludable("manual_flag"), false);
    assert.equal(ruleFor("manual_flag"), undefined);
  });
});

describe("describeFraudEvent", () => {
  it("lit les détails de chaque règle", () => {
    assert.match(describeFraudEvent("round_the_clock", { day: "2026-10-12", hours: 23, plays: 92 }), /23 hours.*2026-10-12.*92 plays/);
    assert.match(describeFraudEvent("track_repetition", { day: "2026-10-12", plays: 120 }), /120 plays of the same track/);
    assert.match(
      describeFraudEvent("qualification_farming", { day: "d", just_qualified_plays: 60, qualified_plays: 60, share: 1 }),
      /60 of 60 counted plays \(100%\)/
    );
    assert.match(
      describeFraudEvent("new_account_burst", { day: "d", plays: 25, accounts: 12, new_account_share: 1 }),
      /25 plays from 12 accounts.*100%/
    );
    assert.match(
      describeFraudEvent("shared_ip_fingerprint", { day: "d", accounts: 5, plays: 50, top_artist_share: 1 }),
      /5 accounts behind one IP fingerprint.*100% on the same artist/
    );
    assert.match(describeFraudEvent("many_countries", { day: "d", countries: 5, country_codes: ["CH", "FR"] }), /5 countries.*CH, FR/);
  });

  it("des détails absents ou invalides donnent des « ? », jamais une erreur", () => {
    for (const details of [null, undefined, {}, "texte", 12, []]) {
      for (const rule of FRAUD_RULES) {
        const text = describeFraudEvent(rule.type, details as never);
        assert.ok(text.length > 0, rule.type);
        assert.doesNotMatch(text, /NaN|undefined|null/);
      }
    }
  });

  it("un type inconnu : texte vide", () => {
    assert.equal(describeFraudEvent("manual_flag", { x: 1 }), "");
  });
});

describe("excludedCount / summarizeDetection", () => {
  it("compte ce qui a été exclu", () => {
    assert.equal(excludedCount({ excluded_plays: 120 }), 120);
    assert.equal(excludedCount({}), 0);
    assert.equal(excludedCount(null), 0);
    assert.equal(excludedCount({ excluded_plays: "abc" }), 0);
  });

  it("résume la détection sans compter les scores", () => {
    assert.equal(
      summarizeDetection([
        { rule: "round_the_clock", created: 2 },
        { rule: "track_repetition", created: 0 },
        { rule: "many_countries", created: 1 },
        { rule: "scores_refreshed", created: 8 },
      ]),
      "3 new events: 2 listening around the clock, 1 many countries in one day."
    );
    assert.equal(summarizeDetection([{ rule: "scores_refreshed", created: 8 }]), "No new event.");
    assert.equal(summarizeDetection([]), "No new event.");
    assert.equal(summarizeDetection([{ rule: "round_the_clock", created: 1 }]), "1 new event: 1 listening around the clock.");
  });
});
