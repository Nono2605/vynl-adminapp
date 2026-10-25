import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EXPECTED_JOBS, FINGERPRINT_CAP_WARN_RATIO, fingerprintWarnings, hoursSince, systemWarnings, TRANSCODE_STALE_HOURS, type ApiConfig, type ScanQueueStatus, type ScheduledJob, type TranscodeStatus, scanQueueWarnings, SCAN_STALE_HOURS } from "./systemReport.ts";

const NOW = new Date("2026-10-24T12:00:00Z");

const goodConfig: ApiConfig = {
  deploy: { commit: "3e662c9", node: "v22.1.0", uptime_seconds: 100 },
  entitlement_mode: "beta",
  auth_local_verify: true,
  secrets: { ip_hash_secret: true, webapp_shared_secret: true, stripe_secret_key: true, stripe_webhook_secret: true, cdn_token_secret: true },
  stripe: { mode: "test", allow_live: false, automatic_tax: true },
  checkout_return_host: "app.vynl.ch",
  cdn: { active: true, host: "cdn.vynl.li", configured_host: "cdn.vynl.li" },
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

  describe("CDN audio", () => {
    const withCdn = (cdn: ApiConfig["cdn"], secret: boolean): ApiConfig => ({ ...goodConfig, cdn, secrets: { ...goodConfig.secrets, cdn_token_secret: secret } });
    const warn = (config: ApiConfig) => systemWarnings({ config, jobs: goodJobs, schema: null, now: NOW });

    it("actif : rien à signaler", () => {
      assert.deepEqual(warn(goodConfig), []);
    });

    it("une API déployée avant le CDN (champ absent) : on ne dit rien", () => {
      const { cdn: _cdn, ...old } = goodConfig;
      void _cdn;
      assert.deepEqual(warn(old as ApiConfig), []);
    });

    it("ni adresse ni secret : simple information", () => {
      const warnings = warn(withCdn({ active: false, host: null, configured_host: null }, false));
      assert.deepEqual(warnings.map((w) => w.level), ["info"]);
      assert.match(warnings[0].text, /served by Supabase/);
    });

    it("adresse sans secret, ou secret sans adresse : à corriger", () => {
      const noSecret = warn(withCdn({ active: false, host: null, configured_host: "cdn.vynl.li" }, false));
      assert.deepEqual(noSecret.map((w) => w.level), ["warn"]);
      assert.match(noSecret[0].text, /CDN_TOKEN_SECRET is not/);
      const noUrl = warn(withCdn({ active: false, host: null, configured_host: null }, true));
      assert.deepEqual(noUrl.map((w) => w.level), ["warn"]);
      assert.match(noUrl[0].text, /CDN_BASE_URL is missing/);
    });

    it("adresse et secret réglés mais adresse refusée (http) : à corriger", () => {
      const warnings = warn(withCdn({ active: false, host: null, configured_host: "cdn.vynl.li" }, true));
      assert.equal(warnings.length, 1);
      assert.match(warnings[0].text, /not valid/);
    });
  });

  describe("transcodage", () => {
    const status = (over: Partial<TranscodeStatus> = {}): TranscodeStatus => ({
      queued: 0, running: 0, done: 10, failed: 0, oldest_open_at: null, last_error: null,
      renditions: 20, tracks_with_cdn: 10, tracks_with_audio: 10, pending_deletions: 0, ...over,
    });
    const check = (transcode: TranscodeStatus | null) => systemWarnings({ config: null, jobs: goodJobs, schema: null, transcode, now: NOW });

    it("pas demandé, ou tout est fait : rien à signaler", () => {
      assert.deepEqual(systemWarnings({ config: null, jobs: goodJobs, schema: null, now: NOW }), []);
      assert.deepEqual(check(status()), []);
    });

    it("la migration manque : on dit laquelle appliquer", () => {
      const warnings = check(null);
      assert.equal(warnings.length, 1);
      assert.equal(warnings[0].level, "info");
      assert.match(warnings[0].text, /20261025000000_audio_renditions\.sql/);
    });

    it("des fichiers en échec : alerte avec la dernière erreur", () => {
      const warnings = check(status({ failed: 2, last_error: "ffmpeg a échoué" }));
      assert.equal(warnings.length, 1);
      assert.match(warnings[0].text, /2 audio files could not be transcoded\. Last error: ffmpeg a échoué/);
      assert.match(check(status({ failed: 1 }))[0].text, /1 audio file could not be transcoded\./);
    });

    it("une file qui avance (tâche récente) n'alerte pas ; une file ancienne alerte", () => {
      assert.deepEqual(check(status({ queued: 5, oldest_open_at: hoursAgo(1) })), []);
      const stuck = check(status({ queued: 5, running: 1, oldest_open_at: hoursAgo(TRANSCODE_STALE_HOURS + 2) }));
      assert.equal(stuck.length, 1);
      assert.match(stuck[0].text, /6 files waiting, the oldest for 8 hours\. Is the worker running/);
    });

    it("une tâche ancienne mais plus rien en attente n'alerte pas", () => {
      assert.deepEqual(check(status({ queued: 0, running: 0, oldest_open_at: hoursAgo(50) })), []);
    });
  });
});

describe("fingerprintWarnings : le contrôle d'empreinte ACRCloud", () => {
  type Fingerprint = NonNullable<ApiConfig["fingerprint"]>;
  const active: Fingerprint = {
    active: true,
    host: "identify-eu-west-1.acrcloud.com",
    missing: [],
    warn_score: 60,
    fail_score: null,
    monthly_cap: 300,
    requests_this_month: 12,
  };
  const off = (missing: string[]): Fingerprint => ({ ...active, active: false, host: null, missing, requests_this_month: null });

  it("une API qui ne le rapporte pas encore : rien n'est dit", () => {
    assert.deepEqual(fingerprintWarnings(undefined), []);
  });

  it("actif et loin du plafond : rien à signaler", () => {
    assert.deepEqual(fingerprintWarnings(active), []);
  });

  it("pas posé du tout : une simple note, pas une alerte (le contrôle est facultatif)", () => {
    const warnings = fingerprintWarnings(off(["ACRCLOUD_HOST", "ACRCLOUD_ACCESS_KEY", "ACRCLOUD_ACCESS_SECRET"]));
    assert.equal(warnings.length, 1);
    assert.equal(warnings[0].level, "info");
    assert.match(warnings[0].text, /not set up on the API/);
  });

  it("à moitié posé : une alerte qui nomme ce qui manque", () => {
    const warnings = fingerprintWarnings(off(["ACRCLOUD_ACCESS_SECRET"]));
    assert.equal(warnings[0].level, "warn");
    assert.match(warnings[0].text, /half set up/);
    assert.match(warnings[0].text, /ACRCLOUD_ACCESS_SECRET/);
  });

  it("à 80 % du plafond : on prévient ; juste en dessous : non", () => {
    const limit = Math.ceil(300 * FINGERPRINT_CAP_WARN_RATIO);
    assert.deepEqual(fingerprintWarnings({ ...active, requests_this_month: limit - 1 }), []);
    const warnings = fingerprintWarnings({ ...active, requests_this_month: limit });
    assert.equal(warnings[0].level, "warn");
    assert.match(warnings[0].text, /nearly reached \(240 of 300/);
  });

  it("au plafond (ou au-delà) : alerte qui dit ce qui se passe et où le relever", () => {
    for (const used of [300, 450]) {
      const [warning] = fingerprintWarnings({ ...active, requests_this_month: used });
      assert.equal(warning.level, "warn");
      assert.match(warning.text, /cap is reached/);
      assert.match(warning.text, /without the fingerprint/);
      assert.match(warning.text, /ACRCLOUD_MONTHLY_REQUESTS/);
    }
  });

  it("compteur inconnu : aucune alerte de plafond inventée", () => {
    assert.deepEqual(fingerprintWarnings({ ...active, requests_this_month: null }), []);
  });

  it("un plafond à 0 (contrôle coupé) est atteint tout de suite", () => {
    assert.match(fingerprintWarnings({ ...active, monthly_cap: 0, requests_this_month: 0 })[0].text, /cap is reached/);
  });

  it("branché sur systemWarnings : le rapport de l'API est pris en compte", () => {
    const warnings = systemWarnings({
      config: { ...goodConfig, fingerprint: { ...active, requests_this_month: 300 } },
      jobs: goodJobs,
      schema: null,
      now: NOW,
    });
    assert.ok(warnings.some((w) => /ACRCloud monthly cap is reached/.test(w.text)));
    assert.ok(!systemWarnings({ config: goodConfig, jobs: goodJobs, schema: null, now: NOW }).some((w) => /ACRCloud|fingerprint/.test(w.text)));
  });
});

describe("file des contrôles automatiques", () => {
  const queue = (over: Partial<ScanQueueStatus> = {}): ScanQueueStatus => ({
    queued: 0, running: 0, done: 5, failed: 0, oldest_open_at: null, last_failure: null,
    fingerprint_unavailable_7d: 0, last_fingerprint_problem: null, ...over,
  });

  it("pas demandé : aucun avertissement", () => {
    assert.deepEqual(scanQueueWarnings(undefined, true, NOW), []);
  });

  it("la table n'existe pas : on dit quelle migration appliquer", () => {
    const warnings = scanQueueWarnings(null, false, NOW);
    assert.equal(warnings.length, 1);
    assert.equal(warnings[0].level, "warn");
    assert.match(warnings[0].text, /20261026000000_scan_jobs\.sql/);
  });

  it("tout va bien : rien à signaler", () => {
    assert.deepEqual(scanQueueWarnings(queue(), true, NOW), []);
    assert.deepEqual(scanQueueWarnings(queue({ queued: 2, oldest_open_at: hoursAgo(1) }), true, NOW), []);
  });

  it("des contrôles abandonnés : avec la dernière erreur", () => {
    const warnings = scanQueueWarnings(queue({ failed: 2, last_failure: { message: "ffmpeg failed (killed by SIGKILL)", at: hoursAgo(3) } }), true, NOW);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0].text, /2 automatic checks gave up.*SIGKILL/);
    assert.match(scanQueueWarnings(queue({ failed: 1 }), true, NOW)[0].text, /^1 automatic check gave up/);
  });

  it("une file qui n'avance pas : alerte au bout de deux heures", () => {
    assert.deepEqual(scanQueueWarnings(queue({ queued: 3, oldest_open_at: hoursAgo(SCAN_STALE_HOURS) }), true, NOW), []);
    const stuck = scanQueueWarnings(queue({ queued: 3, running: 1, oldest_open_at: hoursAgo(SCAN_STALE_HOURS + 3) }), true, NOW);
    assert.equal(stuck.length, 1);
    assert.match(stuck[0].text, /4 tracks waiting, the oldest for 5 hours/);
  });

  it("l'empreinte qui n'a pas pu répondre : le message d'ACRCloud est repris", () => {
    const problem = queue({ fingerprint_unavailable_7d: 3, last_fingerprint_problem: { message: "ACRCloud code 3014: invalid signature (wrong access secret?)", at: hoursAgo(1) } });
    const warnings = scanQueueWarnings(problem, true, NOW);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0].text, /could not run 3 times in the last 7 days\. Last problem: ACRCloud code 3014/);
  });

  it("empreinte non activée : ses anciens ratés ne sont pas relevés", () => {
    assert.deepEqual(scanQueueWarnings(queue({ fingerprint_unavailable_7d: 3 }), false, NOW), []);
  });

  it("intégré au rapport complet de la page System", () => {
    const warnings = systemWarnings({ config: null, jobs: goodJobs, schema: null, scanQueue: null, now: NOW });
    assert.equal(warnings.some((w) => /scan_jobs/.test(w.text)), true);
  });
});

