import Link from "next/link";
import { runFraudDetection } from "@/app/actions/fraud";
import { ActionForm } from "@/components/ActionForm";
import { FilterPills } from "@/components/FilterPills";
import { Notice } from "@/components/Notice";
import { PageHead } from "@/components/PageHead";
import { Pager } from "@/components/Pager";
import { StatCard } from "@/components/StatCard";
import { StatusBadge } from "@/components/StatusBadge";
import { FRAUD_RULES, describeFraudEvent, ruleFor } from "@/lib/fraudRules";
import { formatDateTime } from "@/lib/format";
import { first, oneOf, pageRange, parsePage, pick, type SearchParams } from "@/lib/query";
import { requireAdmin } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { daysAgo } from "@/lib/time";

const VIEWS = ["open", "resolved"] as const;
const SCORE_LIMIT = 20;

interface EventRow {
  id: string;
  user_id: string | null;
  listening_session_id: string | null;
  event_type: string;
  severity: string;
  details: unknown;
  detected_at: string;
  resolved: boolean;
  users: { email: string } | { email: string }[] | null;
  tracks: { title: string } | { title: string }[] | null;
}

interface ScoreRow {
  id: string;
  subject_type: string;
  subject_id: string;
  score: number | string;
  factors: unknown;
  computed_at: string;
}

function preview(value: unknown): string {
  if (value === null || value === undefined) return "—";
  const text = JSON.stringify(value);
  if (text === "{}" || text === "[]") return "—";
  return text.length > 70 ? `${text.slice(0, 70)}…` : text;
}

function scoreHref(score: ScoreRow): string | null {
  switch (score.subject_type) {
    case "user":
      return `/users/${score.subject_id}`;
    case "track":
      return `/catalog/tracks/${score.subject_id}`;
    case "session":
      return `/plays/${score.subject_id}`;
    default:
      return null;
  }
}

export default async function FraudPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireAdmin();

  const params = await searchParams;
  // « open » par défaut : ce qui reste à traiter. L'onglet « All » n'existe pas
  // exprès, un événement est soit ouvert soit résolu.
  const view = oneOf(pick(params, "view"), VIEWS) ?? "open";
  const page = parsePage(params);
  const [from, to] = pageRange(page);

  const db = supabaseAdmin();
  const head = { count: "exact", head: true } as const;
  const since7d = daysAgo(7).toISOString();

  const [events, scores, open, resolved, highOpen, excluded, excluded7d] = await Promise.all([
    db
      .from("fraud_events")
      .select(
        "id, user_id, listening_session_id, event_type, severity, details, detected_at, resolved, users(email), tracks(title)",
        { count: "exact" }
      )
      .eq("resolved", view === "resolved")
      .order("detected_at", { ascending: false })
      .range(from, to),
    db
      .from("fraud_scores")
      .select("id, subject_type, subject_id, score, factors, computed_at")
      .order("score", { ascending: false })
      .limit(SCORE_LIMIT),
    db.from("fraud_events").select("id", head).eq("resolved", false),
    db.from("fraud_events").select("id", head).eq("resolved", true),
    db.from("fraud_events").select("id", head).eq("resolved", false).in("severity", ["high", "critical"]),
    db.from("plays").select("id", head).eq("counted", false),
    db.from("plays").select("id", head).eq("counted", false).gte("started_at", since7d),
  ]);

  const rows = (events.data ?? []) as unknown as EventRow[];
  const scoreRows = (scores.data ?? []) as unknown as ScoreRow[];
  const count = (result: { count: number | null; error: unknown }) => (result.error ? null : result.count);

  return (
    <>
      <PageHead title="Fraud" />

      <div className="stat-grid">
        <StatCard label="Open events" value={count(open)} warn />
        <StatCard label="Open, high severity" value={count(highOpen)} warn />
        <StatCard label="Resolved events" value={count(resolved)} />
        <StatCard label="Excluded plays" value={count(excluded)} hint="All time" />
        <StatCard label="Excluded, last 7 days" value={count(excluded7d)} />
      </div>

      <section className="dash-card section-gap">
        <h2 className="section-title">Detection</h2>
        <p className="muted" style={{ marginBottom: "var(--space-sm)" }}>
          {FRAUD_RULES.length} rules look at the listening day by day and write an event for what a person has little reason to
          do. The detection only flags: nothing is excluded until you decide, event by event. Running it twice never writes the
          same event twice. It examines the last three complete days; it can also be scheduled (see the API migration). An
          excluded play stays in the history but no longer counts toward earnings.
        </p>
        <ActionForm action={runFraudDetection} submitLabel="Run the detection" pendingLabel="Running…" tone="secondary">
          <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", color: "var(--vynl-texte-2)" }}>
            <input type="checkbox" name="include_today" />
            Include today (the day is not over: figures are not final)
          </label>
        </ActionForm>
        <details className="history" style={{ marginTop: "var(--space-sm)" }}>
          <summary>What is checked</summary>
          <table className="table" style={{ marginTop: "var(--space-xs)" }}>
            <tbody>
              {FRAUD_RULES.map((rule) => (
                <tr key={rule.type}>
                  <td className="cell-main">{rule.title}</td>
                  <td className="muted">{rule.what}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      </section>

      <h2 className="section-title section-gap">Events</h2>
      <FilterPills
        basePath="/fraud"
        param="view"
        current={view}
        params={{}}
        options={[
          { label: "Open", value: "open", count: count(open) },
          { label: "Resolved", value: "resolved", count: count(resolved) },
        ]}
      />

      {events.error && <Notice>Could not load fraud events: {events.error.message}</Notice>}

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Detected</th>
              <th>Type</th>
              <th>Severity</th>
              <th>User</th>
              <th>Track</th>
              <th>Details</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="empty">
                  {view === "open" ? "No open fraud event." : "No resolved fraud event."}
                </td>
              </tr>
            )}
            {rows.map((event) => (
              <tr key={event.id}>
                <td>{formatDateTime(event.detected_at)}</td>
                <td>{ruleFor(event.event_type)?.title ?? event.event_type}</td>
                <td>
                  <StatusBadge status={event.severity} />
                </td>
                <td className="cell-main">
                  {event.user_id ? (
                    <Link href={`/users/${event.user_id}`} className="text-link">
                      {first(event.users)?.email ?? event.user_id}
                    </Link>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="cell-main">{first(event.tracks)?.title ?? "—"}</td>
                <td className="cell-main muted">
                  {describeFraudEvent(event.event_type, event.details as Record<string, unknown> | null) || preview(event.details)}
                </td>
                <td>
                  <Link href={`/fraud/${event.id}`} className="btn btn-secondary btn-sm">
                    Open
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Pager basePath="/fraud" params={{ view }} page={page} total={events.count ?? 0} />

      <h2 className="section-title section-gap">Highest fraud scores</h2>
      {scores.error && <Notice>Could not load fraud scores: {scores.error.message}</Notice>}
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Subject</th>
              <th className="num">Score</th>
              <th>Factors</th>
              <th>Computed</th>
            </tr>
          </thead>
          <tbody>
            {scoreRows.length === 0 && (
              <tr>
                <td colSpan={4} className="empty">
                  No score computed yet.
                </td>
              </tr>
            )}
            {scoreRows.map((score) => {
              const href = scoreHref(score);
              return (
                <tr key={score.id}>
                  <td className="cell-main">
                    {score.subject_type}{" "}
                    {href ? (
                      <Link href={href} className="text-link">
                        {score.subject_id.slice(0, 8)}…
                      </Link>
                    ) : (
                      <code>{score.subject_id.slice(0, 8)}…</code>
                    )}
                  </td>
                  <td className="num">{Number(score.score)}</td>
                  <td className="cell-main muted">{preview(score.factors)}</td>
                  <td>{formatDateTime(score.computed_at)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
