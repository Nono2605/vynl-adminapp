import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EXPECTED_JOBS, hoursSince, systemWarnings, type ApiConfig, type ScheduledJob } from "./systemReport.ts";

const NOW = new Date("2026-10-24T12:00:00Z");

const goodConfig: ApiConfig = {
  deploy: { commit: "3e662c9", node: "v22.1.0", uptime_seconds: 100 },
  entitlement_mode: "beta",
  auth_local_verify: true,
  secrets: { ip_hash_secret: true, webapp_shared_secret: true, stripe_secret_key: true, stripe_webhook_secret: true },
  stripe: { mode: "test", allow_live: false, automatic_tax: true },
  checkout_return_host: "app.vynl.ch",
  cors_allowed_origins: ["https://app.vynl.ch"],
};

const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * 3_600_000).toISOString();
const job = (name: string, over: Partial<ScheduledJob> = {}): ScheduledJob => ({
  job_name: name,
  schedule: "15 3 * * *",
  active: true,
  last_started_at: hoursAgo(9),
  last_finished_at: hoursAgo(9),
  last_status: "succeeded",
  last_message: null,
  ...over,
});
const goodJobs = EXPECTED_JOBS.map((expected) => job(expected.name));

describe("hoursSince", () => {
  it("compte les heures écoulées", () => {
    assert.equal(hoursSince(hoursAgo(5), NOW), 5);
  });

  it("rend null sans date ou avec une date illisible", () => {
    assert.equal(hoursSince(null, NOW), null);
    assert.equal(hoursSince("pas une date", NOW), null);
  });
});

describe("systemWarnings", () => {
  it("rien à signaler quand tout est réglé", () => {
    assert.deepEqual(systemWarnings({ config: goodConfig, jobs: goodJobs, schema: { a: true, b: true }, now: NOW }), []);
  });

  it("signale l'empreinte d'IP absente et le secret partagé absent", () => {
    const config = { ...goodConfig, secrets: { ...goodConfig.secrets, ip_hash_secret: false, webapp_shared_secret: false } };
    const texts = systemWarnings({ config, jobs: goodJobs, schema: null, now: NOW }).map((w) => w.text);
    assert.equal(texts.some((t) => t.includes("IP_HASH_SECRET")), true);
    assert.equal(texts.some((t) => t.includes("WEBAPP_SHARED_SECRET")), true);
  });

  it("l'interrupteur éteint et la TVA non calculée sont de simples informations", () => {
    const config = { ...goodConfig, auth_local_verify: false, stripe: { ...goodConfig.stripe, automatic_tax: false } };
    const warnings = systemWarnings({ config, jobs: goodJobs, schema: null, now: NOW });
    assert.deepEqual(warnings.map((w) => w.level), ["info", "info"]);
  });

  it("Stripe : clé absente, ou clé présente sans secret de webhook", () => {
    const noKey = { ...goodConfig, secrets: { ...goodConfig.secrets, stripe_secret_key: false, stripe_webhook_secret: false } };
    const noKeyTexts = systemWarnings({ config: noKey, jobs: goodJobs, schema: null, now: NOW }).map((w) => w.text);
    assert.equal(noKeyTexts.some((t) => t.includes("Stripe is not connected")), true);
    // Sans clé, on ne parle pas du webhook ni de la TVA.
    assert.equal(noKeyTexts.some((t) => t.includes("STRIPE_WEBHOOK_SECRET") || t.includes("STRIPE_AUTOMATIC_TAX")), false);

    const noHook = { ...goodConfig, secrets: { ...goodConfig.secrets, stripe_webhook_secret: false } };
    assert.equal(systemWarnings({ config: noHook, jobs: goodJobs, schema: null, now: NOW }).some((w) => w.text.includes("STRIPE_WEBHOOK_SECRET")), true);
  });

  it("signale l'adresse de retour de paiement absente et le mode live des droits d'écoute", () => {
    const config = { ...goodConfig, checkout_return_host: null, entitlement_mode: "live" as const };
    const warnings = systemWarnings({ config, jobs: goodJobs, schema: null, now: NOW });
    assert.equal(warnings.some((w) => w.text.includes("CHECKOUT_RETURN_BASE_URL")), true);
    assert.equal(warnings.some((w) => w.level === "info" && w.text.includes("ENTITLEMENT_MODE")), true);
  });

  it("la fonction des tâches absente : on dit quelle migration appliquer", () => {
    const warnings = systemWarnings({ config: goodConfig, jobs: null, schema: null, now: NOW });
    assert.equal(warnings.length, 1);
    assert.match(warnings[0].text, /20261024000000_scheduled_jobs\.sql/);
  });

  it("aucune tâche planifiée : une alerte par tâche attendue", () => {
    const warnings = systemWarnings({ config: goodConfig, jobs: [], schema: null, now: NOW });
    assert.equal(warnings.length, EXPECTED_JOBS.length);
    assert.equal(warnings.every((w) => w.level === "warn" && w.text.includes("not scheduled")), true);
  });

  it("une tâche éteinte, échouée ou en retard est signalée", () => {
    const jobs = [
      job("vynl-retention", { active: false }),
      job("vynl-fraud-detect", { last_status: "failed", last_message: "boom" }),
      job("vynl-cron-log", { last_started_at: hoursAgo(9 * 24) }),
    ];
    const texts = systemWarnings({ config: null, jobs, schema: null, now: NOW }).map((w) => w.text);
    assert.equal(texts.length, 3);
    assert.match(texts[0], /switched off/);
    assert.match(texts[1], /failed on its last run: boom/);
    assert.match(texts[2], /has not run for 216 hours/);
  });

  it("une tâche quotidienne qui a tourné hier soir ne déclenche rien", () => {
    const jobs = EXPECTED_JOBS.map((expected) => job(expected.name, { last_started_at: hoursAgo(20) }));
    assert.deepEqual(systemWarnings({ config: null, jobs, schema: null, now: NOW }), []);
  });

  it("une tâche jamais exécutée n'est pas encore en retard", () => {
    const jobs = EXPECTED_JOBS.map((expected) => job(expected.name, { last_started_at: null, last_status: null }));
    assert.deepEqual(systemWarnings({ config: null, jobs, schema: null, now: NOW }), []);
  });

  it("liste les migrations qui ne répondent pas", () => {
    const warnings = systemWarnings({ config: null, jobs: goodJobs, schema: { genres: true, fraud_detection: false, creator_stats: false }, now: NOW });
    assert.equal(warnings.length, 1);
    assert.match(warnings[0].text, /fraud_detection, creator_stats/);
  });

  it("sans réponse de l'API, on ne devine rien sur sa configuration", () => {
    assert.deepEqual(systemWarnings({ config: null, jobs: goodJobs, schema: null, now: NOW }), []);
  });
});
