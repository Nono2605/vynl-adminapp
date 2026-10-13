import Link from "next/link";
import { notFound } from "next/navigation";
import { excludeEventPlays, resolveFraudEvent } from "@/app/actions/fraud";
import { ActionForm } from "@/components/ActionForm";
import { AuditTrail } from "@/components/AuditTrail";
import { PageHead } from "@/components/PageHead";
import { StatusBadge } from "@/components/StatusBadge";
import { describeFraudEvent, excludedCount, isExcludable, ruleFor } from "@/lib/fraudRules";
import { formatDateTime } from "@/lib/format";
import { first, isUuid } from "@/lib/query";
import { requireAdmin } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase/admin";

interface EventRow {
  id: string;
  user_id: string | null;
  track_id: string | null;
  listening_session_id: string | null;
  event_type: string;
  severity: string;
  details: unknown;
  detected_at: string;
  resolved: boolean;
  resolved_at: string | null;
  users: { email: string } | { email: string }[] | null;
  tracks: { title: string } | { title: string }[] | null;
}

export default async function FraudEventPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();

  const { id } = await params;
  if (!isUuid(id)) notFound();

  const { data, error } = await supabaseAdmin()
    .from("fraud_events")
    .select(
      "id, user_id, track_id, listening_session_id, event_type, severity, details, detected_at, resolved, resolved_at, users(email), tracks(title)"
    )
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(`Could not load the fraud event: ${error.message}`);
  if (!data) notFound();

  const event = data as unknown as EventRow;
  const email = first(event.users)?.email;
  const trackTitle = first(event.tracks)?.title;
  const hasDetails = event.details !== null && event.details !== undefined && JSON.stringify(event.details) !== "{}";
  const details = (event.details && typeof event.details === "object" ? event.details : {}) as Record<string, unknown>;
  const rule = ruleFor(event.event_type);
  const sentence = describeFraudEvent(event.event_type, details);
  const alreadyExcluded = excludedCount(details);

  // Les écoutes encore COMPTÉES derrière cet événement (lecture seule : la fonction SQL ne modifie rien).
  const exclusion = isExcludable(event.event_type)
    ? await supabaseAdmin().rpc("fraud_event_plays", { p_event_id: event.id }, { count: "exact", head: true })
    : null;
  const countedPlays = exclusion && !exclusion.error ? (exclusion.count ?? 0) : null;

  return (
    <>
      <p className="muted">
        <Link href="/fraud" className="text-link">
          Fraud
        </Link>{" "}
        / {event.event_type}
      </p>
      <PageHead title={rule?.title ?? event.event_type} plain>
        <span style={{ display: "inline-flex", gap: "var(--space-xs)" }}>
          <StatusBadge status={event.severity} />
          {event.resolved ? <StatusBadge status="resolved" /> : <span className="status status--warn">open</span>}
        </span>
      </PageHead>

      <div className="decision-grid">
        <section className="dash-card">
          <h2 className="section-title">Event</h2>
          <dl className="kv">
            <dt>Detected</dt>
            <dd>{formatDateTime(event.detected_at)}</dd>
            <dt>Resolved</dt>
            <dd>{event.resolved ? formatDateTime(event.resolved_at) : "Not yet"}</dd>
            <dt>User</dt>
            <dd>
              {event.user_id ? (
                <Link href={`/users/${event.user_id}`} className="text-link">
                  {email ?? event.user_id}
                </Link>
              ) : (
                "—"
              )}
            </dd>
            <dt>Track</dt>
            <dd>
              {event.track_id ? (
                <Link href={`/catalog/tracks/${event.track_id}`} className="text-link">
                  {trackTitle ?? event.track_id}
                </Link>
              ) : (
                "—"
              )}
            </dd>
            <dt>Play</dt>
            <dd>
              {event.listening_session_id ? (
                <Link href={`/plays/${event.listening_session_id}`} className="text-link">
                  Open the play
                </Link>
              ) : (
                "—"
              )}
            </dd>
          </dl>
        </section>

        <section className="dash-card">
          <h2 className="section-title">{event.resolved ? "Reopen" : "Resolve"}</h2>
          {event.resolved ? (
            <ActionForm action={resolveFraudEvent} submitLabel="Reopen the event" pendingLabel="Saving…" tone="secondary">
              <input type="hidden" name="eventId" value={event.id} />
              <input type="hidden" name="decision" value="reopen" />
              <textarea name="note" maxLength={500} placeholder="Why? (optional, kept in the audit log)" className="input-field" />
            </ActionForm>
          ) : (
            <>
              <ActionForm action={resolveFraudEvent} submitLabel="Mark as resolved" pendingLabel="Saving…">
                <input type="hidden" name="eventId" value={event.id} />
                <input type="hidden" name="decision" value="resolve" />
                <textarea
                  name="note"
                  maxLength={500}
                  placeholder="What was decided? (optional, kept in the audit log)"
                  className="input-field"
                />
              </ActionForm>
              <p className="muted" style={{ marginTop: "var(--space-xs)" }}>
                Resolving does not exclude any play. To stop a play from counting, open it and exclude it.
              </p>
            </>
          )}
        </section>
      </div>

      {(sentence || rule) && (
        <section className="section-gap">
          <h2 className="section-title">What was detected</h2>
          {sentence && <p>{sentence}</p>}
          {rule && <p className="muted">{rule.what}</p>}
        </section>
      )}

      {rule && (
        <section className="section-gap">
          <h2 className="section-title">Plays behind this event</h2>
          {!rule.excludable ? (
            <p className="muted">
              This kind of event is a signal to review, not a set of plays to exclude in one gesture. Open the listener and exclude
              plays one by one if needed.
            </p>
          ) : countedPlays === null ? (
            <p className="muted">The detection is not installed yet: apply the latest migrations of the API repository.</p>
          ) : (
            <>
              <p>
                <strong>{countedPlays}</strong> counted play{countedPlays === 1 ? "" : "s"} still count behind this event
                {alreadyExcluded > 0 ? `; ${alreadyExcluded} already excluded from it` : ""}. Excluded plays stay in the history but
                no longer count toward earnings.
              </p>
              {countedPlays > 0 && (
                <ActionForm
                  action={excludeEventPlays}
                  submitLabel={`Exclude ${countedPlays} play${countedPlays === 1 ? "" : "s"}`}
                  pendingLabel="Excluding…"
                  tone="danger"
                  confirm={`Exclude ${countedPlays} play${countedPlays === 1 ? "" : "s"}? They stay in the history but no longer count.`}
                >
                  <input type="hidden" name="eventId" value={event.id} />
                  <textarea
                    name="reason"
                    required
                    minLength={3}
                    maxLength={500}
                    placeholder="Why are these plays excluded? (kept in the audit log and on each play)"
                    className="input-field"
                  />
                </ActionForm>
              )}
            </>
          )}
        </section>
      )}

      <section className="section-gap">
        <h2 className="section-title">Details recorded by the detection</h2>
        {hasDetails ? <pre className="json">{JSON.stringify(event.details, null, 2)}</pre> : <p className="muted">No details recorded.</p>}
      </section>

      <section className="section-gap">
        <h2 className="section-title">Admin activity on this event</h2>
        <AuditTrail targetType="fraud_event" targetId={event.id} />
      </section>
    </>
  );
}
