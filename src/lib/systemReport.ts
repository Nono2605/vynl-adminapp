// Page « System » : les types du rapport de l'API et de la liste des tâches planifiées, et les points d'attention qu'on
// en tire. Fonctions pures (l'heure est passée en paramètre) : testables seules.

export interface ApiConfig {
  deploy: { commit: string | null; node: string; uptime_seconds: number };
  entitlement_mode: "beta" | "live";
  auth_local_verify: boolean;
  secrets: {
    ip_hash_secret: boolean;
    webapp_shared_secret: boolean;
    stripe_secret_key: boolean;
    stripe_webhook_secret: boolean;
    // Absents d'une API déployée avant le CDN : on ne dit rien tant que l'API ne les donne pas.
    cdn_token_secret?: boolean;
  };
  stripe: { mode: "test" | "live" | null; allow_live: boolean; automatic_tax: boolean };
  checkout_return_host: string | null;
  cdn?: { active: boolean; host: string | null; configured_host: string | null };
  cors_allowed_origins: string[];
}

// Ce que rend admin_transcode_status() (migration 20261025000000_audio_renditions.sql) : l'état des versions AAC du CDN.
export interface TranscodeStatus {
  queued: number;
  running: number;
  done: number;
  failed: number;
  oldest_open_at: string | null;
  last_error: string | null;
  renditions: number;
  tracks_with_cdn: number;
  tracks_with_audio: number;
  pending_deletions: number;
}

export interface ScheduledJob {
  job_name: string;
  schedule: string;
  active: boolean;
  last_started_at: string | null;
  last_finished_at: string | null;
  last_status: string | null;
  last_message: string | null;
}

// Les tâches que la migration 20261024000000_scheduled_jobs.sql planifie, et l'âge maximal de leur dernière exécution
// avant qu'on s'inquiète (une tâche quotidienne qui n'a pas tourné depuis un jour et demi, une hebdomadaire depuis huit jours).
export const EXPECTED_JOBS = [
  { name: "vynl-retention", label: "Retention purge", maxAgeHours: 36 },
  { name: "vynl-fraud-detect", label: "Fraud detection", maxAgeHours: 36 },
  { name: "vynl-cron-log", label: "Cron log cleanup", maxAgeHours: 8 * 24 },
] as const;

export const JOBS_MIGRATION = "20261024000000_scheduled_jobs.sql";
export const RENDITIONS_MIGRATION = "20261025000000_audio_renditions.sql";

// Une tâche de transcodage en attente depuis plus longtemps que ça : le worker ne tourne pas, ou il est bloqué.
export const TRANSCODE_STALE_HOURS = 6;

export interface Warning {
  level: "warn" | "info";
  text: string;
}

export function hoursSince(iso: string | null, now: Date): number | null {
  if (!iso) return null;
  const then = Date.parse(iso);
  return Number.isNaN(then) ? null : (now.getTime() - then) / 3_600_000;
}

export interface SystemInput {
  // null : l'API n'a pas répondu (ou pas encore la route).
  config: ApiConfig | null;
  // null : la fonction admin_scheduled_jobs() n'existe pas (migration pas appliquée) ; [] : pg_cron sans tâche.
  jobs: ScheduledJob[] | null;
  schema: Record<string, boolean> | null;
  // undefined : pas demandé. null : la fonction admin_transcode_status() n'existe pas (migration pas appliquée).
  transcode?: TranscodeStatus | null;
  now: Date;
}

export function systemWarnings({ config, jobs, schema, transcode, now }: SystemInput): Warning[] {
  const out: Warning[] = [];

  if (config) {
    if (!config.secrets.ip_hash_secret) {
      out.push({
        level: "warn",
        text: "IP fingerprints are not collected (IP_HASH_SECRET is not set on the API): the shared-IP fraud rule cannot fire.",
      });
    }
    if (!config.secrets.webapp_shared_secret) {
      out.push({
        level: "warn",
        text: "The API believes the country, device and IP that any caller sends (WEBAPP_SHARED_SECRET is not set on the API).",
      });
    }
    if (!config.auth_local_verify) {
      out.push({
        level: "info",
        text: "Every request still asks Supabase Auth who the token belongs to (AUTH_LOCAL_VERIFY is off).",
      });
    }
    if (!config.secrets.stripe_secret_key) {
      out.push({ level: "warn", text: "Stripe is not connected: the API has no Stripe secret key." });
    } else if (!config.secrets.stripe_webhook_secret) {
      out.push({ level: "warn", text: "Stripe events are refused: STRIPE_WEBHOOK_SECRET is not set on the API." });
    }
    if (config.secrets.stripe_secret_key && !config.stripe.automatic_tax) {
      out.push({
        level: "info",
        text: "Stripe does not compute tax yet: payments record a tax of 0 (STRIPE_AUTOMATIC_TAX is off).",
      });
    }
    if (!config.checkout_return_host) {
      out.push({ level: "warn", text: "The checkout return address is not set (CHECKOUT_RETURN_BASE_URL): customers cannot come back from Stripe." });
    }
    if (config.cdn) {
      if (!config.cdn.active) {
        if (config.cdn.configured_host && !config.secrets.cdn_token_secret) {
          out.push({ level: "warn", text: "The audio CDN address is set but CDN_TOKEN_SECRET is not: listening still goes through Supabase." });
        } else if (!config.cdn.configured_host && config.secrets.cdn_token_secret) {
          out.push({ level: "warn", text: "CDN_TOKEN_SECRET is set but CDN_BASE_URL is missing or invalid (it must start with https://): listening still goes through Supabase." });
        } else if (config.cdn.configured_host) {
          out.push({ level: "warn", text: `The audio CDN address is not valid (CDN_BASE_URL, host ${config.cdn.configured_host}): it must start with https://.` });
        } else {
          out.push({ level: "info", text: "Listening is served by Supabase: the audio CDN is not set up on the API yet (CDN_BASE_URL, CDN_TOKEN_SECRET)." });
        }
      }
    }
    if (config.entitlement_mode === "live") {
      out.push({ level: "info", text: "Listening rights follow subscriptions (ENTITLEMENT_MODE is live): plays are no longer all beta." });
    }
  }

  if (jobs === null) {
    out.push({ level: "warn", text: `Scheduled jobs cannot be read: apply ${JOBS_MIGRATION} (API repository) in the Supabase SQL editor.` });
  } else {
    for (const expected of EXPECTED_JOBS) {
      const job = jobs.find((row) => row.job_name === expected.name);
      if (!job) {
        out.push({ level: "warn", text: `${expected.label} is not scheduled (${expected.name}). Enable pg_cron, then apply ${JOBS_MIGRATION}.` });
        continue;
      }
      if (!job.active) {
        out.push({ level: "warn", text: `${expected.label} is switched off (${expected.name}).` });
        continue;
      }
      if (job.last_status === "failed") {
        out.push({ level: "warn", text: `${expected.label} failed on its last run${job.last_message ? `: ${job.last_message}` : "."}` });
        continue;
      }
      const age = hoursSince(job.last_started_at, now);
      if (age !== null && age > expected.maxAgeHours) {
        out.push({ level: "warn", text: `${expected.label} has not run for ${Math.round(age)} hours.` });
      }
    }
  }

  if (transcode === null) {
    out.push({ level: "info", text: `Audio renditions are not tracked yet: apply ${RENDITIONS_MIGRATION} (API repository) in the Supabase SQL editor.` });
  } else if (transcode) {
    if (transcode.failed > 0) {
      out.push({
        level: "warn",
        text: `${transcode.failed} audio file${transcode.failed === 1 ? "" : "s"} could not be transcoded${transcode.last_error ? `. Last error: ${transcode.last_error}` : "."}`,
      });
    }
    const waiting = transcode.queued + transcode.running;
    const age = hoursSince(transcode.oldest_open_at, now);
    if (waiting > 0 && age !== null && age > TRANSCODE_STALE_HOURS) {
      out.push({
        level: "warn",
        text: `The transcoding queue is not moving: ${waiting} file${waiting === 1 ? "" : "s"} waiting, the oldest for ${Math.round(age)} hours. Is the worker running on Render?`,
      });
    }
  }

  if (schema) {
    const missing = Object.entries(schema)
      .filter(([, ok]) => !ok)
      .map(([name]) => name);
    if (missing.length > 0) {
      out.push({ level: "warn", text: `Migrations not applied or not answering: ${missing.join(", ")}.` });
    }
  }

  return out;
}
