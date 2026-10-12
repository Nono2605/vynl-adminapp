import Link from "next/link";
import { Notice } from "@/components/Notice";
import { PageHead } from "@/components/PageHead";
import { LastDecision } from "@/components/ReviewFlow";
import { StatCard } from "@/components/StatCard";
import { StatusBadge } from "@/components/StatusBadge";
import { formatDateTime, formatDuration } from "@/lib/format";
import { declarationState, sumSplits, trackChecks } from "@/lib/moderation";
import { embeddedCount, first, oneOf, pick, type SearchParams } from "@/lib/query";
import { QUEUE_KINDS, QUEUE_LABEL, reviewPath, skipPath } from "@/lib/reviewQueue";
import { requireAdmin } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase/admin";

const QUEUE_LIMIT = 50;

interface QueuedTrack {
  id: string;
  title: string;
  duration_seconds: number | null;
  updated_at: string;
  artists: { id: string; name: string } | { id: string; name: string }[] | null;
  track_files: { count: number }[];
  ai_declarations: { status: string; provenance: string; declared_at: string }[] | null;
  splits: { percentage: number | string }[] | null;
}

interface QueuedAlbum {
  id: string;
  title: string;
  type: string;
  updated_at: string;
  artists: { name: string } | { name: string }[] | null;
  tracks: { count: number }[];
}

interface Decision {
  id: string;
  created_at: string;
  admin_email: string;
  action: string;
  target_type: string;
  target_id: string | null;
  target_label: string | null;
  outcome: string;
  details: { reason?: string; to?: string } | null;
}

export default async function ModerationPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireAdmin();

  // Arrivée depuis le mode file d'attente quand il n'y a plus rien à relire.
  const params = await searchParams;
  const done = oneOf(pick(params, "done"), QUEUE_KINDS);

  const db = supabaseAdmin();

  const [tracks, albums, decisions] = await Promise.all([
    db
      .from("tracks")
      .select(
        "id, title, duration_seconds, updated_at, artists(id, name), track_files(count), ai_declarations(status, provenance, declared_at), splits(percentage)",
        { count: "exact" }
      )
      .eq("status", "in_review")
      .order("updated_at", { ascending: true })
      .limit(QUEUE_LIMIT),
    db
      .from("albums")
      .select("id, title, type, updated_at, artists(name), tracks(count)", { count: "exact" })
      .eq("status", "in_review")
      .order("updated_at", { ascending: true })
      .limit(QUEUE_LIMIT),
    db
      .from("admin_audit_log")
      .select("id, created_at, admin_email, action, target_type, target_id, target_label, outcome, details")
      .in("target_type", ["track", "album", "ai_declaration"])
      .order("created_at", { ascending: false })
      .limit(10),
  ]);

  const trackRows = (tracks.data ?? []) as unknown as QueuedTrack[];
  const albumRows = (albums.data ?? []) as unknown as QueuedAlbum[];
  const decisionRows = (decisions.data ?? []) as unknown as Decision[];

  const errors = [tracks, albums].map((result) => result.error?.message).filter(Boolean);
  const count = (result: { count: number | null; error: unknown }) => (result.error ? null : result.count);

  return (
    <>
      <PageHead title="Moderation" />

      {errors.length > 0 && <Notice>Some queues could not be loaded: {errors[0]}</Notice>}

      {done && (
        <section className="dash-card" style={{ marginBottom: "var(--space-sm)" }}>
          <h2 className="section-title">All caught up</h2>
          <p className="muted">No more {QUEUE_LABEL[done].toLowerCase()} are waiting for a decision.</p>
          <LastDecision decision={pick(params, "last")} title={pick(params, "lastTitle")} />
        </section>
      )}

      <div className="stat-grid">
        <StatCard label="Tracks in review" value={count(tracks)} warn />
        <StatCard label="Albums in review" value={count(albums)} warn />
      </div>

      <div className="page-head section-gap" style={{ marginBottom: "var(--space-xs)" }}>
        <h2 className="section-title" style={{ marginBottom: 0 }}>
          New tracks waiting for a decision
        </h2>
        {trackRows.length > 0 && (
          <Link href={skipPath("tracks")} prefetch={false} className="btn btn-primary btn-sm">
            Review one by one ({count(tracks) ?? trackRows.length})
          </Link>
        )}
      </div>
      <p className="muted" style={{ marginBottom: "var(--space-sm)" }}>
        Oldest first. “Review one by one” opens the oldest track and moves on to the next as soon as you publish or refuse
        one. You can also open a single track from the list.
      </p>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Track</th>
              <th>Artist</th>
              <th className="num">Duration</th>
              <th>Waiting since</th>
              <th>Checks</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {trackRows.length === 0 && (
              <tr>
                <td colSpan={6} className="empty">
                  Nothing waiting: every submitted track has been decided.
                </td>
              </tr>
            )}
            {trackRows.map((track) => {
              const latest = [...(track.ai_declarations ?? [])].sort((a, b) => b.declared_at.localeCompare(a.declared_at))[0];
              const checks = trackChecks({
                durationSeconds: track.duration_seconds,
                fileCount: embeddedCount(track.track_files),
                declaration: declarationState(latest),
                splitsTotal: sumSplits(track.splits),
              });
              const problems = checks.filter((check) => check.state !== "ok");
              return (
                <tr key={track.id}>
                  <td className="cell-main">
                    <Link href={reviewPath("tracks", track.id)} className="text-link">
                      {track.title}
                    </Link>
                  </td>
                  <td>{first(track.artists)?.name ?? "—"}</td>
                  <td className="num">{formatDuration(track.duration_seconds)}</td>
                  <td>{formatDateTime(track.updated_at)}</td>
                  <td>
                    {problems.length === 0 ? (
                      <StatusBadge status="approved" />
                    ) : (
                      <span style={{ display: "inline-flex", flexWrap: "wrap", gap: "0.35rem" }}>
                        {problems.map((check) => (
                          <span
                            key={check.key}
                            className={`status status--${check.state === "fail" ? "error" : "warn"}`}
                            title={check.detail}
                          >
                            {check.label}
                          </span>
                        ))}
                      </span>
                    )}
                  </td>
                  <td>
                    <Link href={reviewPath("tracks", track.id)} className="btn btn-secondary btn-sm">
                      Review
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {(tracks.count ?? 0) > QUEUE_LIMIT && <p className="muted">Showing the {QUEUE_LIMIT} oldest of {tracks.count}.</p>}

      <div className="page-head section-gap" style={{ marginBottom: "var(--space-xs)" }}>
        <h2 className="section-title" style={{ marginBottom: 0 }}>
          New albums waiting for a decision
        </h2>
        {albumRows.length > 0 && (
          <Link href={skipPath("albums")} prefetch={false} className="btn btn-primary btn-sm">
            Review one by one ({count(albums) ?? albumRows.length})
          </Link>
        )}
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Album</th>
              <th>Artist</th>
              <th>Type</th>
              <th className="num">Tracks</th>
              <th>Waiting since</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {albumRows.length === 0 && (
              <tr>
                <td colSpan={6} className="empty">
                  No album waiting.
                </td>
              </tr>
            )}
            {albumRows.map((album) => (
              <tr key={album.id}>
                <td className="cell-main">
                  <Link href={reviewPath("albums", album.id)} className="text-link">
                    {album.title}
                  </Link>
                </td>
                <td>{first(album.artists)?.name ?? "—"}</td>
                <td>{album.type}</td>
                <td className="num">{embeddedCount(album.tracks)}</td>
                <td>{formatDateTime(album.updated_at)}</td>
                <td>
                  <Link href={reviewPath("albums", album.id)} className="btn btn-secondary btn-sm">
                    Review
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="section-title section-gap">Recent decisions</h2>
      {decisions.error ? (
        <Notice>
          The audit log is not available: {decisions.error.message}. Apply the admin actions migration in Supabase, otherwise no
          decision can be recorded.
        </Notice>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>When</th>
                <th>Admin</th>
                <th>Decision</th>
                <th>Item</th>
                <th>Reason</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {decisionRows.length === 0 && (
                <tr>
                  <td colSpan={6} className="empty">
                    No decision yet.
                  </td>
                </tr>
              )}
              {decisionRows.map((entry) => (
                <tr key={entry.id}>
                  <td>{formatDateTime(entry.created_at)}</td>
                  <td className="cell-main">{entry.admin_email}</td>
                  <td>{entry.action}</td>
                  <td className="cell-main">{entry.target_label ?? entry.target_id ?? "—"}</td>
                  <td className="cell-main">{entry.details?.reason ?? "—"}</td>
                  <td>
                    <StatusBadge status={entry.outcome === "success" ? "approved" : entry.outcome === "failed" ? "failed" : "pending"} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
