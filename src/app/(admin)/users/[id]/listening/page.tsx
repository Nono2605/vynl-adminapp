import Link from "next/link";
import { notFound } from "next/navigation";
import { Notice } from "@/components/Notice";
import { PageHead } from "@/components/PageHead";
import { Pager } from "@/components/Pager";
import { ShareBar } from "@/components/ShareBar";
import { StatusBadge } from "@/components/StatusBadge";
import { getUserTopArtists } from "@/lib/analytics";
import { ActionError, recordAccess } from "@/lib/actions";
import { formatDateTime, formatDuration, formatListening, formatNumber } from "@/lib/format";
import { first, isUuid, pageRange, parsePage, type SearchParams } from "@/lib/query";
import { requireAdmin } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase/admin";

interface PlayRow {
  id: string;
  started_at: string;
  validated_seconds: number;
  qualified: boolean;
  counted: boolean;
  excluded_reason: string | null;
  country_code: string | null;
  device_type: string | null;
  source_context: string | null;
  tracks: { title: string } | { title: string }[] | null;
  artists: { name: string } | { name: string }[] | null;
}

// L'historique d'écoute d'UN compte : donnée personnelle sensible. L'accès est écrit dans
// le journal d'audit AVANT l'affichage ; si le journal est indisponible, rien n'est montré.
export default async function UserListeningPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const admin = await requireAdmin();

  const { id } = await params;
  if (!isUuid(id)) notFound();
  const page = parsePage(await searchParams);
  const [from, to] = pageRange(page);

  const db = supabaseAdmin();
  const { data: user, error } = await db.from("users").select("id, email").eq("id", id).maybeSingle();
  if (error) throw new Error(`Could not load the user: ${error.message}`);
  if (!user) notFound();

  try {
    await recordAccess(admin, "user.view_listening", { type: "user", id, label: user.email });
  } catch (accessError) {
    if (!(accessError instanceof ActionError)) throw accessError;
    return (
      <>
        <p className="muted">
          <Link href={`/users/${id}`} className="text-link">
            {user.email}
          </Link>{" "}
          / listening history
        </p>
        <PageHead title="Listening history" />
        <Notice>{accessError.message}</Notice>
      </>
    );
  }

  const [plays, topArtists] = await Promise.all([
    db
      .from("plays")
      .select(
        "id, started_at, validated_seconds, qualified, counted, excluded_reason, country_code, device_type, source_context, tracks(title), artists(name)",
        { count: "exact" }
      )
      .eq("user_id", id)
      .order("started_at", { ascending: false })
      .range(from, to),
    getUserTopArtists(id, 10),
  ]);

  const rows = (plays.data ?? []) as unknown as PlayRow[];
  const artistMax = Math.max(...topArtists.data.map((artist) => artist.plays), 1);

  return (
    <>
      <p className="muted">
        <Link href={`/users/${id}`} className="text-link">
          {user.email}
        </Link>{" "}
        / listening history
      </p>
      <PageHead title="Listening history" />

      <p className="review-reason" style={{ borderColor: "var(--vynl-bordure)", background: "var(--vynl-abysse)" }}>
        This access is recorded in the audit log. Use it for support or to investigate suspicious listening, not to browse.
      </p>

      {plays.error && <Notice>Could not load the plays: {plays.error.message}</Notice>}

      <section className="dash-card">
        <h2 className="section-title">Most played artists</h2>
        {topArtists.error ? (
          <Notice>
            {topArtists.missing
              ? "The analytics functions are not installed yet: apply supabase/migrations/20261011200000_admin_analytics.sql."
              : topArtists.error}
          </Notice>
        ) : topArtists.data.length === 0 ? (
          <p className="muted">No qualified play yet.</p>
        ) : (
          <table className="table">
            <tbody>
              {topArtists.data.map((artist) => (
                <tr key={artist.artist_id}>
                  <td className="cell-main">{artist.name}</td>
                  <td style={{ width: "32%" }}>
                    <ShareBar value={artist.plays} max={artistMax} />
                  </td>
                  <td className="num">{formatNumber(artist.plays)} plays</td>
                  <td className="num muted">{formatListening(artist.seconds)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <h2 className="section-title section-gap">Plays</h2>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>When</th>
              <th>Track</th>
              <th>Artist</th>
              <th className="num">Listened</th>
              <th>Result</th>
              <th>Country</th>
              <th>Device</th>
              <th>Started from</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="empty">
                  No plays.
                </td>
              </tr>
            )}
            {rows.map((play) => (
              <tr key={play.id}>
                <td>
                  <Link href={`/plays/${play.id}`} className="text-link">
                    {formatDateTime(play.started_at)}
                  </Link>
                </td>
                <td className="cell-main">{first(play.tracks)?.title ?? "—"}</td>
                <td>{first(play.artists)?.name ?? "—"}</td>
                <td className="num">{formatDuration(play.validated_seconds)}</td>
                <td>
                  {play.counted ? (
                    <StatusBadge status={play.qualified ? "approved" : "open"} />
                  ) : (
                    <StatusBadge status="rejected" />
                  )}{" "}
                  <span className="muted">
                    {play.counted ? (play.qualified ? "qualified" : "counted") : (play.excluded_reason ?? "excluded")}
                  </span>
                </td>
                <td>{play.country_code ?? "—"}</td>
                <td>{play.device_type ?? "—"}</td>
                <td>{play.source_context ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Pager basePath={`/users/${id}/listening`} params={{}} page={page} total={plays.count ?? 0} />
    </>
  );
}
