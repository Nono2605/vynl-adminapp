import { Notice } from "@/components/Notice";
import { PageHead } from "@/components/PageHead";
import { StatusBadge } from "@/components/StatusBadge";
import { apiGet } from "@/lib/apiClient";
import { formatDateTime } from "@/lib/format";
import { collectionChecks, scanQueueStatus, schemaChecks } from "@/lib/healthChecks";
import { requireAdmin } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { EXPECTED_JOBS, SCANS_MIGRATION, systemWarnings, type ApiConfig, type ScheduledJob, type TranscodeStatus } from "@/lib/systemReport";

// « Réglé » ou « manquant » : jamais la valeur d'un secret (l'API ne la donne pas).
function Flag({ on, onLabel = "set", offLabel = "missing" }: { on: boolean; onLabel?: string; offLabel?: string }) {
  return <span className={`status ${on ? "status--ok" : "status--warn"}`}>{on ? onLabel : offLabel}</span>;
}

function uptime(seconds: number): string {
  if (seconds < 3600) return `${Math.max(1, Math.round(seconds / 60))} min`;
  if (seconds < 86_400) return `${(seconds / 3600).toFixed(1)} h`;
  return `${(seconds / 86_400).toFixed(1)} days`;
}

export default async function SystemPage() {
  await requireAdmin();

  const [config, jobsResult, transcodeResult, schema, collection, scanQueue] = await Promise.all([
    apiGet<ApiConfig>("/admin/config"),
    supabaseAdmin().rpc("admin_scheduled_jobs"),
    supabaseAdmin().rpc("admin_transcode_status"),
    schemaChecks().catch(() => null),
    collectionChecks().catch(() => null),
    scanQueueStatus().catch(() => undefined),
  ]);

  const apiConfig = config.ok ? config.data : null;
  const jobs = jobsResult.error ? null : ((jobsResult.data ?? []) as ScheduledJob[]);
  // La fonction rend une ligne ; une erreur veut dire que la migration des versions AAC n'est pas appliquée.
  const transcode = transcodeResult.error
    ? null
    : ((Array.isArray(transcodeResult.data) ? transcodeResult.data[0] : transcodeResult.data) as TranscodeStatus | undefined) ?? null;
  const warnings = systemWarnings({ config: apiConfig, jobs, schema, transcode, scanQueue, now: new Date() });
  const problems = warnings.filter((warning) => warning.level === "warn");
  const notes = warnings.filter((warning) => warning.level === "info");

  return (
    <>
      <PageHead title="System" />

      {!config.ok && (
        <Notice>
          {config.notConfigured
            ? "This admin does not know where the API is (API_BASE_URL)."
            : config.status === 404
              ? "The API does not give its configuration yet: wait for its latest deploy on Render."
              : `The API configuration could not be read: ${config.error}`}
        </Notice>
      )}
      {problems.map((warning) => (
        <div key={warning.text} className="section-gap">
          <Notice>{warning.text}</Notice>
        </div>
      ))}
      {warnings.length === 0 && (
        <section className="dash-card dash-card--featured">
          <p>
            <span className="status status--ok">all good</span> Nothing to report: secrets set, jobs running, migrations in place.
          </p>
        </section>
      )}
      {notes.length > 0 && (
        <ul className="muted section-gap">
          {notes.map((warning) => (
            <li key={warning.text}>{warning.text}</li>
          ))}
        </ul>
      )}

      <h2 className="section-title section-gap">API</h2>
      {apiConfig ? (
        <div className="dash-card">
          <dl className="kv">
            <dt>Version deployed</dt>
            <dd>{apiConfig.deploy.commit ? <code>{apiConfig.deploy.commit}</code> : <span className="muted">unknown</span>}</dd>
            <dt>Node</dt>
            <dd>{apiConfig.deploy.node}</dd>
            <dt>Up for</dt>
            <dd>{uptime(apiConfig.deploy.uptime_seconds)}</dd>
            <dt>Listening rights</dt>
            <dd>
              <StatusBadge status={apiConfig.entitlement_mode === "live" ? "paying" : "free"} /> {apiConfig.entitlement_mode}
            </dd>
            {apiConfig.subscriptions_open !== undefined && (
              <>
                <dt>Subscriptions</dt>
                <dd>
                  <span className={`status ${apiConfig.subscriptions_open ? "status--warn" : "status--idle"}`}>
                    {apiConfig.subscriptions_open ? "open" : "closed (beta)"}
                  </span>
                </dd>
              </>
            )}
            <dt>Local token check</dt>
            <dd>
              <Flag on={apiConfig.auth_local_verify} onLabel="on" offLabel="off" />
            </dd>
            <dt>Stripe</dt>
            <dd>{apiConfig.stripe.mode ? `${apiConfig.stripe.mode} mode` : "not connected"}</dd>
            <dt>Tax computed by Stripe</dt>
            <dd>
              <Flag on={apiConfig.stripe.automatic_tax} onLabel="on" offLabel="off" />
            </dd>
            <dt>Checkout return address</dt>
            <dd>{apiConfig.checkout_return_host ?? <span className="muted">not set</span>}</dd>
            <dt>Allowed origins</dt>
            <dd>{apiConfig.cors_allowed_origins.length > 0 ? apiConfig.cors_allowed_origins.join(", ") : <span className="muted">none</span>}</dd>
          </dl>
        </div>
      ) : (
        <p className="muted">Not available.</p>
      )}

      <h2 className="section-title section-gap">Secrets on the API</h2>
      {apiConfig ? (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Variable</th>
                <th>State</th>
                <th>What it does</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="cell-main">IP_HASH_SECRET</td>
                <td>
                  <Flag on={apiConfig.secrets.ip_hash_secret} />
                </td>
                <td className="muted">Salts IP fingerprints (shared-IP fraud rule)</td>
              </tr>
              <tr>
                <td className="cell-main">WEBAPP_SHARED_SECRET</td>
                <td>
                  <Flag on={apiConfig.secrets.webapp_shared_secret} />
                </td>
                <td className="muted">Proves the listener app is the caller (country, device, IP are trusted only from it)</td>
              </tr>
              <tr>
                <td className="cell-main">STRIPE_SECRET_KEY</td>
                <td>
                  <Flag on={apiConfig.secrets.stripe_secret_key} />
                </td>
                <td className="muted">Lets the API talk to Stripe</td>
              </tr>
              <tr>
                <td className="cell-main">STRIPE_WEBHOOK_SECRET</td>
                <td>
                  <Flag on={apiConfig.secrets.stripe_webhook_secret} />
                </td>
                <td className="muted">Verifies the events Stripe sends</td>
              </tr>
              {apiConfig.secrets.cdn_token_secret !== undefined && (
                <tr>
                  <td className="cell-main">CDN_TOKEN_SECRET</td>
                  <td>
                    <Flag on={apiConfig.secrets.cdn_token_secret} />
                  </td>
                  <td className="muted">Signs listening addresses for the audio CDN (same value as on the Cloudflare Worker)</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted">Not available.</p>
      )}

      <h2 className="section-title section-gap">Audio delivery (CDN)</h2>
      {apiConfig?.cdn || transcode ? (
        <div className="dash-card">
          <dl className="kv">
            <dt>CDN used by the API</dt>
            <dd>
              {apiConfig?.cdn ? (
                <>
                  <Flag on={apiConfig.cdn.active} onLabel="on" offLabel="off" /> {apiConfig.cdn.host ?? apiConfig.cdn.configured_host ?? ""}
                </>
              ) : (
                <span className="muted">unknown</span>
              )}
            </dd>
            {transcode && (
              <>
                <dt>Tracks served by the CDN</dt>
                <dd>
                  {transcode.tracks_with_cdn} of {transcode.tracks_with_audio}
                </dd>
                <dt>AAC versions ready</dt>
                <dd>{transcode.renditions}</dd>
                <dt>Transcoding queue</dt>
                <dd>
                  {transcode.queued} waiting, {transcode.running} running, {transcode.done} done, {transcode.failed} failed
                </dd>
                <dt>Oldest file waiting since</dt>
                <dd>{transcode.oldest_open_at ? formatDateTime(transcode.oldest_open_at) : <span className="muted">nothing waiting</span>}</dd>
                <dt>CDN files to delete</dt>
                <dd>{transcode.pending_deletions}</dd>
              </>
            )}
          </dl>
        </div>
      ) : (
        <p className="muted">Not available.</p>
      )}

      <h2 className="section-title section-gap">Audio fingerprint (ACRCloud)</h2>
      {apiConfig?.fingerprint ? (
        <div className="dash-card">
          <dl className="kv">
            <dt>Check on every submitted track</dt>
            <dd>
              <Flag on={apiConfig.fingerprint.active} onLabel="on" offLabel="off" /> {apiConfig.fingerprint.host ?? ""}
              {!apiConfig.fingerprint.active && apiConfig.fingerprint.missing.length > 0 && (
                <span className="muted"> to set on the API: {apiConfig.fingerprint.missing.join(", ")}</span>
              )}
            </dd>
            {apiConfig.fingerprint.active && (
              <>
                <dt>Requests sent this month</dt>
                <dd>
                  {apiConfig.fingerprint.requests_this_month === null ? (
                    <span className="muted">unknown</span>
                  ) : (
                    <>
                      {apiConfig.fingerprint.requests_this_month} of {apiConfig.fingerprint.monthly_cap}{" "}
                      <span className="muted">
                        ({Math.round((apiConfig.fingerprint.requests_this_month / Math.max(1, apiConfig.fingerprint.monthly_cap)) * 100)}%)
                      </span>
                    </>
                  )}
                </dd>
                <dt>Monthly cap</dt>
                <dd>
                  {apiConfig.fingerprint.monthly_cap} requests <span className="muted">(ACRCLOUD_MONTHLY_REQUESTS; about 3 per track)</span>
                </dd>
                <dt>Warning from score</dt>
                <dd>
                  {apiConfig.fingerprint.warn_score} of 100 <span className="muted">(ACRCLOUD_WARN_SCORE)</span>
                </dd>
                <dt>Automatic refusal</dt>
                <dd>
                  {apiConfig.fingerprint.fail_score === null ? (
                    <span className="muted">never: a recognition is a warning, you decide</span>
                  ) : (
                    <>from score {apiConfig.fingerprint.fail_score} (ACRCLOUD_FAIL_SCORE)</>
                  )}
                </dd>
              </>
            )}
          </dl>
          <p className="muted" style={{ marginTop: "var(--space-xs)" }}>
            The ACRCloud plan itself (its own request quota) is only visible in the ACRCloud console.
          </p>
        </div>
      ) : (
        <p className="muted">Not available (the API does not report it yet).</p>
      )}

      <h2 className="section-title section-gap">Automatic checks</h2>
      {scanQueue === undefined ? (
        <p className="muted">The queue could not be read.</p>
      ) : scanQueue === null ? (
        <p className="muted">The queue does not exist yet: apply {SCANS_MIGRATION} (API repository). Until then no automatic check runs.</p>
      ) : (
        <div className="dash-card">
          <dl className="kv">
            <dt>Queue</dt>
            <dd>
              {scanQueue.queued} waiting, {scanQueue.running} running, {scanQueue.done} done, {scanQueue.failed} gave up
            </dd>
            <dt>Oldest track waiting since</dt>
            <dd>{scanQueue.oldest_open_at ? formatDateTime(scanQueue.oldest_open_at) : <span className="muted">nothing waiting</span>}</dd>
            <dt>Last check that gave up</dt>
            <dd>
              {scanQueue.last_failure ? (
                <>
                  {formatDateTime(scanQueue.last_failure.at)} <span className="muted">{scanQueue.last_failure.message ?? ""}</span>
                </>
              ) : (
                <span className="muted">none</span>
              )}
            </dd>
            <dt>Fingerprint could not run (7 days)</dt>
            <dd>
              {scanQueue.fingerprint_unavailable_7d}
              {scanQueue.last_fingerprint_problem && (
                <>
                  {" "}
                  <span className="muted">
                    last: {formatDateTime(scanQueue.last_fingerprint_problem.at)} {scanQueue.last_fingerprint_problem.message ?? ""}
                  </span>
                </>
              )}
            </dd>
          </dl>
        </div>
      )}

      <h2 className="section-title section-gap">Scheduled jobs</h2>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Job</th>
              <th>Schedule (UTC)</th>
              <th>Last run</th>
              <th>Result</th>
            </tr>
          </thead>
          <tbody>
            {EXPECTED_JOBS.map((expected) => {
              const job = jobs?.find((row) => row.job_name === expected.name);
              return (
                <tr key={expected.name}>
                  <td className="cell-main">
                    {expected.label} <span className="muted">{expected.name}</span>
                  </td>
                  <td>{job ? <code>{job.schedule}</code> : "—"}</td>
                  <td>{job ? formatDateTime(job.last_started_at) : "—"}</td>
                  <td>
                    {!job ? (
                      <span className="status status--warn">{jobs === null ? "cannot read" : "not scheduled"}</span>
                    ) : !job.active ? (
                      <span className="status status--warn">off</span>
                    ) : job.last_status ? (
                      <>
                        <StatusBadge status={job.last_status === "succeeded" ? "ok" : job.last_status === "failed" ? "failed" : "pending"} />{" "}
                        {job.last_status === "failed" && job.last_message ? <span className="muted">{job.last_message}</span> : null}
                      </>
                    ) : (
                      <span className="muted">not run yet</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <h2 className="section-title section-gap">Database</h2>
      {schema ? (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Migration</th>
                <th>State</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(schema).map(([name, ok]) => (
                <tr key={name}>
                  <td className="cell-main">{name.replace(/_/g, " ")}</td>
                  <td>
                    <Flag on={ok} onLabel="in place" offLabel="missing" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted">The database did not answer.</p>
      )}
      <p className="muted">
        The scheduled-jobs migration is only listed above once it is applied. Migrations of the API repository are applied by hand in
        the Supabase SQL editor.
      </p>

      <h2 className="section-title section-gap">Data collection</h2>
      {collection ? (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Plays carrying…</th>
                <th>Seen</th>
              </tr>
            </thead>
            <tbody>
              {[
                ["plays_with_country", "a country"],
                ["plays_with_device", "a device"],
                ["plays_with_ip_hash", "an IP fingerprint"],
                ["plays_with_source", "an origin (album, playlist…)"],
              ].map(([key, label]) => (
                <tr key={key}>
                  <td className="cell-main">{label}</td>
                  <td>
                    <Flag on={Boolean(collection[key])} onLabel="yes" offLabel="never" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted">Not available.</p>
      )}
    </>
  );
}
