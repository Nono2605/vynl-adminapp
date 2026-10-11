import Link from "next/link";
import { notFound } from "next/navigation";
import { reviewAlbum } from "@/app/actions/moderation";
import { ActionForm } from "@/components/ActionForm";
import { AuditTrail } from "@/components/AuditTrail";
import { Notice } from "@/components/Notice";
import { PageHead } from "@/components/PageHead";
import { StatusBadge } from "@/components/StatusBadge";
import { formatDate, formatDateTime, formatDuration } from "@/lib/format";
import { first, isUuid } from "@/lib/query";
import { requireAdmin } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase/admin";

interface AlbumTrack {
  id: string;
  catalog_code: string | null;
  title: string;
  status: string;
  track_number: number | null;
  duration_seconds: number | null;
}

export default async function AlbumReviewPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();

  const { id } = await params;
  if (!isUuid(id)) notFound();

  const db = supabaseAdmin();

  const [album, tracks, rejection] = await Promise.all([
    db
      .from("albums")
      .select("id, catalog_code, title, slug, type, status, release_date, created_at, updated_at, artists(id, catalog_code, name)")
      .eq("id", id)
      .maybeSingle(),
    db
      .from("tracks")
      .select("id, catalog_code, title, status, track_number, duration_seconds")
      .eq("album_id", id)
      .order("track_number", { ascending: true, nullsFirst: false }),
    // Colonne ajoutée par la migration des actions d'admin : lue à part.
    db.from("albums").select("rejection_reason").eq("id", id).maybeSingle(),
  ]);

  if (album.error) throw new Error(`Could not load the album: ${album.error.message}`);
  if (!album.data) notFound();

  const row = album.data as unknown as {
    id: string;
    catalog_code: string | null;
    title: string;
    slug: string;
    type: string;
    status: string;
    release_date: string | null;
    created_at: string;
    updated_at: string;
    artists: { id: string; catalog_code: string | null; name: string } | { id: string; catalog_code: string | null; name: string }[] | null;
  };
  const artist = first(row.artists);
  const trackRows = (tracks.data ?? []) as AlbumTrack[];
  const rejectionReason = (rejection.data as { rejection_reason: string | null } | null)?.rejection_reason ?? null;
  const canPublish = trackRows.length > 0;

  return (
    <>
      <p className="muted">
        <Link href="/catalog?view=albums" className="text-link">
          Catalog
        </Link>{" "}
        / {row.title}
      </p>
      <PageHead title={row.title} plain>
        <span style={{ display: "inline-flex", gap: "var(--space-xs)" }}>
          <StatusBadge status={row.status} />
          <span className="badge">{row.type}</span>
        </span>
      </PageHead>

      {tracks.error && <Notice>Could not load the tracks: {tracks.error.message}</Notice>}

      {rejectionReason && (
        <p className="review-reason">
          <strong>Last {row.status === "archived" ? "take-down" : "refusal"} reason:</strong> {rejectionReason}
        </p>
      )}

      <div className="decision-grid">
        <section className="dash-card">
          <h2 className="section-title">Details</h2>
          <dl className="kv">
            <dt>Catalog number</dt>
            <dd>{row.catalog_code ?? "—"}</dd>
            <dt>Artist</dt>
            <dd>
              {artist ? (
                <Link href={`/catalog?view=albums&artist=${artist.id}`} className="text-link">
                  {artist.name}
                </Link>
              ) : (
                "—"
              )}
            </dd>
            <dt>Release date</dt>
            <dd>{formatDate(row.release_date)}</dd>
            <dt>Created</dt>
            <dd>{formatDateTime(row.created_at)}</dd>
            <dt>Last update</dt>
            <dd>{formatDateTime(row.updated_at)}</dd>
          </dl>
        </section>

        <section className="dash-card">
          <h2 className="section-title">Decision</h2>
          {row.status === "in_review" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)" }}>
              {canPublish ? (
                <ActionForm
                  action={reviewAlbum}
                  submitLabel="Approve and publish"
                  pendingLabel="Publishing…"
                  confirm={`Publish "${row.title}"?`}
                >
                  <input type="hidden" name="albumId" value={row.id} />
                  <input type="hidden" name="decision" value="approve" />
                </ActionForm>
              ) : (
                <Notice>An album with no tracks cannot be published.</Notice>
              )}
              <div>
                <h3 className="subsection-title">Refuse</h3>
                <ActionForm
                  action={reviewAlbum}
                  submitLabel="Refuse and send back"
                  pendingLabel="Sending…"
                  tone="danger"
                  confirm={`Send "${row.title}" back to draft? The creator will see your reason.`}
                >
                  <input type="hidden" name="albumId" value={row.id} />
                  <input type="hidden" name="decision" value="refuse" />
                  <textarea
                    name="reason"
                    required
                    minLength={3}
                    maxLength={500}
                    placeholder="Reason shown to the creator"
                    className="input-field"
                  />
                </ActionForm>
              </div>
            </div>
          )}

          {row.status === "published" && (
            <ActionForm
              action={reviewAlbum}
              submitLabel="Take down (archive)"
              pendingLabel="Archiving…"
              tone="danger"
              confirm={`Archive "${row.title}"?`}
            >
              <input type="hidden" name="albumId" value={row.id} />
              <input type="hidden" name="decision" value="archive" />
              <textarea
                name="reason"
                required
                minLength={3}
                maxLength={500}
                placeholder="Reason (shown to the creator, kept in the audit log)"
                className="input-field"
              />
            </ActionForm>
          )}

          {row.status === "archived" &&
            (canPublish ? (
              <ActionForm
                action={reviewAlbum}
                submitLabel="Restore (publish again)"
                pendingLabel="Restoring…"
                confirm={`Publish "${row.title}" again?`}
              >
                <input type="hidden" name="albumId" value={row.id} />
                <input type="hidden" name="decision" value="restore" />
              </ActionForm>
            ) : (
              <Notice>An album with no tracks cannot be published.</Notice>
            ))}

          {row.status === "draft" && (
            <p className="muted">This album is a draft: it is waiting for the creator to submit it for review.</p>
          )}

          <p className="muted" style={{ marginTop: "var(--space-sm)" }}>
            Publishing an album does not publish its tracks: each track is reviewed on its own.
          </p>
        </section>
      </div>

      <section className="section-gap">
        <h2 className="section-title">Tracks</h2>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th className="num">#</th>
                <th>Title</th>
                <th>Catalog number</th>
                <th>Status</th>
                <th className="num">Duration</th>
              </tr>
            </thead>
            <tbody>
              {trackRows.length === 0 && (
                <tr>
                  <td colSpan={5} className="empty">
                    No tracks in this album.
                  </td>
                </tr>
              )}
              {trackRows.map((track) => (
                <tr key={track.id}>
                  <td className="num">{track.track_number ?? "—"}</td>
                  <td className="cell-main">
                    <Link href={`/catalog/tracks/${track.id}`} className="text-link">
                      {track.title}
                    </Link>
                  </td>
                  <td className="muted">{track.catalog_code ?? "—"}</td>
                  <td>
                    <StatusBadge status={track.status} />
                  </td>
                  <td className="num">{formatDuration(track.duration_seconds)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="section-gap">
        <h2 className="section-title">Admin activity on this album</h2>
        <AuditTrail targetType="album" targetId={row.id} />
      </section>
    </>
  );
}
