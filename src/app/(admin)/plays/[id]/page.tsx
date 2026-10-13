import Link from "next/link";
import { notFound } from "next/navigation";
import { setPlayCounted } from "@/app/actions/fraud";
import { ActionForm } from "@/components/ActionForm";
import { AuditTrail } from "@/components/AuditTrail";
import { Notice } from "@/components/Notice";
import { PageHead } from "@/components/PageHead";
import { StatusBadge } from "@/components/StatusBadge";
import { formatDateTime, formatDuration } from "@/lib/format";
import { findFrozenPeriod } from "@/lib/periods";
import { first, isUuid } from "@/lib/query";
import { requireAdmin } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase/admin";

const HEARTBEAT_LIMIT = 200;

interface PlayRow {
  id: string;
  user_id: string | null;
  track_id: string;
  artist_id: string;
  source_context: string | null;
  started_at: string;
  ended_at: string | null;
  validated_seconds: number;
  track_duration_seconds: number | null;
  completed: boolean;
  qualified: boolean;
  qualified_at: string | null;
  counted: boolean;
  excluded_reason: string | null;
  entitlement: string;
  device_type: string | null;
  country_code: string | null;
  ip_hash: string | null;
  client_session_id: string | null;
  app_version: string | null;
  last_heartbeat_at: string;
  last_position_seconds: number;
  last_state: string;
  last_seq: number;
  tracks: { id: string; title: string } | { id: string; title: string }[] | null;
  artists: { id: string; name: string } | { id: string; name: string }[] | null;
  users: { email: string } | { email: string }[] | null;
}

interface Heartbeat {
  seq: number;
  state: string;
  position_seconds: number;
  credited_seconds: number;
  received_at: string;
}

export default async function PlayPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();

  const { id } = await params;
  if (!isUuid(id)) notFound();

  const db = supabaseAdmin();

  const [play, heartbeats, events] = await Promise.all([
    db
      .from("plays")
      .select(
        "id, user_id, track_id, artist_id, source_context, started_at, ended_at, validated_seconds, track_duration_seconds, completed, qualified, qualified_at, counted, excluded_reason, entitlement, device_type, country_code, ip_hash, client_session_id, app_version, last_heartbeat_at, last_position_seconds, last_state, last_seq, tracks(id, title), artists(id, name), users(email)"
      )
      .eq("id", id)
      .maybeSingle(),
    db
      .from("play_heartbeats")
      .select("seq, state, position_seconds, credited_seconds, received_at", { count: "exact" })
      .eq("play_id", id)
      .order("seq", { ascending: true })
      .limit(HEARTBEAT_LIMIT),
    db
      .from("fraud_events")
      .select("id, event_type, severity, detected_at, resolved")
      .eq("listening_session_id", id)
      .order("detected_at", { ascending: false }),
  ]);

  if (play.error) throw new Error(`Could not load the play: ${play.error.message}`);
  if (!play.data) notFound();

  const row = play.data as unknown as PlayRow;
  const track = first(row.tracks);
  const artist = first(row.artists);
  const email = first(row.users)?.email;
  const beats = (heartbeats.data ?? []) as Heartbeat[];
  const fraudEvents = (events.data ?? []) as { id: string; event_type: string; severity: string; detected_at: string; resolved: boolean }[];
  const frozen = await findFrozenPeriod(row.started_at);

  return (
    <>
      <p className="muted">
        <Link href="/plays" className="text-link">
          Plays
        </Link>{" "}
        / {track?.title ?? row.id}
      </p>
      <PageHead title={track?.title ?? "Play"} plain>
        <span style={{ display: "inline-flex", gap: "var(--space-xs)" }}>
          {row.counted ? <StatusBadge status={row.qualified ? "approved" : "open"} /> : <StatusBadge status="rejected" />}
          <span className="muted" style={{ alignSelf: "center" }}>
            {row.counted ? (row.qualified ? "qualified" : "counted") : "excluded"}
          </span>
        </span>
      </PageHead>

      {(heartbeats.error || events.error) && (
        <Notice>Some sections could not be loaded: {heartbeats.error?.message ?? events.error?.message}</Notice>
      )}

      {!row.counted && row.excluded_reason && (
        <p className="review-reason">
          <strong>Excluded:</strong> {row.excluded_reason}
        </p>
      )}

      <div className="decision-grid">
        <section className="dash-card">
          <h2 className="section-title">Play</h2>
          <dl className="kv">
            <dt>Listener</dt>
            <dd>
              {row.user_id ? (
                <Link href={`/users/${row.user_id}`} className="text-link">
                  {email ?? row.user_id}
                </Link>
              ) : (
                "Anonymous"
              )}
            </dd>
            <dt>Track</dt>
            <dd>
              {track ? (
                <Link href={`/catalog/tracks/${track.id}`} className="text-link">
                  {track.title}
                </Link>
              ) : (
                "—"
              )}
            </dd>
            <dt>Artist</dt>
            <dd>
              {artist ? (
                <Link href={`/catalog?artist=${artist.id}`} className="text-link">
                  {artist.name}
                </Link>
              ) : (
                "—"
              )}
            </dd>
            <dt>Started</dt>
            <dd>{formatDateTime(row.started_at)}</dd>
            <dt>Ended</dt>
            <dd>{row.ended_at ? formatDateTime(row.ended_at) : "Still open or never closed"}</dd>
            <dt>Listened</dt>
            <dd>
              {formatDuration(row.validated_seconds)}
              {row.track_duration_seconds ? ` of ${formatDuration(row.track_duration_seconds)}` : ""}
              {row.completed ? " (completed)" : ""}
            </dd>
            <dt>Qualified</dt>
            <dd>{row.qualified ? `Yes, at ${formatDateTime(row.qualified_at)}` : "No"}</dd>
            <dt>Entitlement</dt>
            <dd>{row.entitlement}</dd>
            <dt>Origin</dt>
            <dd>{row.source_context ?? "—"}</dd>
          </dl>
        </section>

        <section className="dash-card">
          <h2 className="section-title">Signals</h2>
          <dl className="kv">
            <dt>Country</dt>
            <dd>{row.country_code ?? "Unknown"}</dd>
            <dt>Device</dt>
            <dd>{row.device_type ?? "Unknown"}</dd>
            <dt>IP fingerprint</dt>
            <dd>{row.ip_hash ? <code>{row.ip_hash.slice(0, 12)}…</code> : "—"}</dd>
            <dt>App version</dt>
            <dd>{row.app_version ?? "—"}</dd>
            <dt>Session</dt>
            <dd>{row.client_session_id ? <code>{row.client_session_id.slice(0, 12)}…</code> : "—"}</dd>
            <dt>Last heartbeat</dt>
            <dd>
              #{row.last_seq} · {row.last_state} · {formatDuration(row.last_position_seconds)} ·{" "}
              {formatDateTime(row.last_heartbeat_at)}
            </dd>
          </dl>
          <p className="muted" style={{ marginTop: "var(--space-xs)" }}>
            The country, device and IP fingerprint are declared by the app and are not verified yet.
          </p>
        </section>
      </div>

      <section className="dash-card section-gap">
        <h2 className="section-title">Decision</h2>
        {frozen ? (
          <Notice>
            This play belongs to the {frozen.status} royalty period {frozen.period_start} to {frozen.period_end}: it can no
            longer change. A correction goes into a later period.
          </Notice>
        ) : row.counted ? (
          <ActionForm
            action={setPlayCounted}
            submitLabel="Exclude this play"
            pendingLabel="Excluding…"
            tone="danger"
            confirm="Exclude this play? It stays in the history but no longer counts toward anyone's earnings."
          >
            <input type="hidden" name="playId" value={row.id} />
            <input type="hidden" name="decision" value="exclude" />
            <textarea
              name="reason"
              required
              minLength={3}
              maxLength={500}
              placeholder="Why is this play suspicious? (kept in the audit log)"
              className="input-field"
            />
          </ActionForm>
        ) : (
          <ActionForm
            action={setPlayCounted}
            submitLabel="Count this play again"
            pendingLabel="Saving…"
            confirm="Count this play again?"
          >
            <input type="hidden" name="playId" value={row.id} />
            <input type="hidden" name="decision" value="include" />
            <textarea
              name="reason"
              maxLength={500}
              placeholder="Note (optional, kept in the audit log)"
              className="input-field"
            />
          </ActionForm>
        )}
      </section>

      {fraudEvents.length > 0 && (
        <section className="section-gap">
          <h2 className="section-title">Fraud events on this play</h2>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Detected</th>
                  <th>Type</th>
                  <th>Severity</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {fraudEvents.map((event) => (
                  <tr key={event.id}>
                    <td>{formatDateTime(event.detected_at)}</td>
                    <td>
                      <Link href={`/fraud/${event.id}`} className="text-link">
                        {event.event_type}
                      </Link>
                    </td>
                    <td>
                      <StatusBadge status={event.severity} />
                    </td>
                    <td>{event.resolved ? <StatusBadge status="resolved" /> : <span className="status status--warn">open</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="section-gap">
        <h2 className="section-title">Heartbeats</h2>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th className="num">#</th>
                <th>State</th>
                <th className="num">Position</th>
                <th className="num">Credited</th>
                <th>Received</th>
              </tr>
            </thead>
            <tbody>
              {beats.length === 0 && (
                <tr>
                  <td colSpan={5} className="empty">
                    No heartbeat recorded.
                  </td>
                </tr>
              )}
              {beats.map((beat) => (
                <tr key={beat.seq}>
                  <td className="num">{beat.seq}</td>
                  <td>{beat.state}</td>
                  <td className="num">{formatDuration(beat.position_seconds)}</td>
                  <td className="num">{Number(beat.credited_seconds).toFixed(1)} s</td>
                  <td>{formatDateTime(beat.received_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {(heartbeats.count ?? 0) > HEARTBEAT_LIMIT && (
          <p className="muted">Showing the first {HEARTBEAT_LIMIT} of {heartbeats.count}.</p>
        )}
      </section>

      <section className="section-gap">
        <h2 className="section-title">Admin activity on this play</h2>
        <AuditTrail targetType="play" targetId={row.id} />
      </section>
    </>
  );
}
