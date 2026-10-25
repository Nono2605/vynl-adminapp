import Link from "next/link";
import { notFound } from "next/navigation";
import { liftClaimBlocks, rejectClaim, startClaimReview, upholdClaim, withdrawClaim } from "@/app/actions/claims";
import { ActionForm } from "@/components/ActionForm";
import { AuditTrail } from "@/components/AuditTrail";
import { ClaimStatusBadge } from "@/components/ClaimStatusBadge";
import { Notice } from "@/components/Notice";
import { PageHead } from "@/components/PageHead";
import { StatusBadge } from "@/components/StatusBadge";
import { formatDateTime, formatDuration } from "@/lib/format";
import { escapeLike, first, isUuid, pick, type SearchParams } from "@/lib/query";
import {
  CAPACITY_LABELS,
  CLAIM_TYPE_LABELS,
  ageInDays,
  claimReference,
  extractTrackId,
  isDecided,
  isOverdue,
} from "@/lib/rightsClaims";
import { requireAdmin } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase/admin";

interface Claim {
  id: string;
  claim_number: number;
  created_at: string;
  claimant_name: string;
  claimant_email: string;
  claimant_organization: string | null;
  capacity: string;
  claim_type: string;
  track_reference: string;
  original_work: string;
  description: string;
  status: string;
  track_id: string | null;
  artist_id: string | null;
  decision_note: string | null;
  decided_at: string | null;
}

interface TrackRow {
  id: string;
  title: string;
  status: string;
  duration_seconds: number | null;
  artist_id: string;
  artists: { id: string; name: string; catalog_code: string | null } | { id: string; name: string; catalog_code: string | null }[] | null;
}

const TRACK_COLUMNS = "id, title, status, duration_seconds, artist_id, artists(id, name, catalog_code)";

function artistLabel(track: TrackRow): string {
  const artist = first(track.artists);
  if (!artist) return "—";
  return artist.catalog_code ? `${artist.name} (${artist.catalog_code})` : artist.name;
}

export default async function ClaimPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SearchParams> }) {
  await requireAdmin();

  const { id } = await params;
  if (!isUuid(id)) notFound();
  const query = await searchParams;

  const db = supabaseAdmin();
  const { data, error } = await db
    .from("rights_claims")
    .select(
      "id, claim_number, created_at, claimant_name, claimant_email, claimant_organization, capacity, claim_type, track_reference, original_work, description, status, track_id, artist_id, decision_note, decided_at"
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`Could not load the claim: ${error.message}`);
  if (!data) notFound();
  const claim = data as Claim;
  const decided = isDecided(claim.status);
  const reference = claimReference(claim.claim_number);
  const now = new Date();

  // Le morceau visé : celui qu'on a choisi dans la recherche (?track=), sinon l'identifiant lu dans ce que le demandeur a écrit.
  const fromQuery = pick(query, "track");
  const candidateId = decided ? claim.track_id : isUuid(fromQuery) ? fromQuery : extractTrackId(claim.track_reference);
  const search = pick(query, "q");

  const [candidate, results, blocked, artistUpheld] = await Promise.all([
    candidateId ? db.from("tracks").select(TRACK_COLUMNS).eq("id", candidateId).maybeSingle() : Promise.resolve(null),
    search.length >= 2 && !decided
      ? db.from("tracks").select(TRACK_COLUMNS).ilike("title", `%${escapeLike(search)}%`).order("title").limit(10)
      : Promise.resolve(null),
    claim.status === "upheld" ? db.from("blocked_files").select("id", { count: "exact", head: true }).eq("claim_id", claim.id) : Promise.resolve(null),
    claim.artist_id ? db.from("rights_claims").select("id", { count: "exact", head: true }).eq("artist_id", claim.artist_id).eq("status", "upheld") : Promise.resolve(null),
  ]);

  const track = (candidate?.data ?? null) as TrackRow | null;
  const trackResults = (results?.data ?? []) as unknown as TrackRow[];
  const blockedCount = blocked && !blocked.error ? (blocked.count ?? 0) : null;

  // Des fichiers du morceau visé, dont combien portent une empreinte (seuls ceux-là peuvent être bloqués).
  let fileCount = 0;
  let hashedCount = 0;
  if (track && !decided) {
    const files = await db.from("track_files").select("id, checksum").eq("track_id", track.id);
    fileCount = files.data?.length ?? 0;
    hashedCount = (files.data ?? []).filter((file: { checksum: string | null }) => file.checksum).length;
  }
  const otherUpheld = artistUpheld && !artistUpheld.error ? (artistUpheld.count ?? 0) : 0;
  const overdue = isOverdue(claim, now);

  return (
    <>
      <p className="muted">
        <Link href="/claims" className="text-link">
          Claims
        </Link>{" "}
        / {reference}
      </p>
      <PageHead title={reference} plain>
        <span style={{ display: "inline-flex", gap: "var(--space-xs)" }}>
          <ClaimStatusBadge status={claim.status} />
          {overdue && <span className="status status--error">overdue · {ageInDays(claim.created_at, now)} days</span>}
        </span>
      </PageHead>

      <div className="decision-grid">
        <section className="dash-card">
          <h2 className="section-title">Claim</h2>
          <dl className="kv">
            <dt>Received</dt>
            <dd>{formatDateTime(claim.created_at)}</dd>
            <dt>Claimant</dt>
            <dd>
              {claim.claimant_name}
              {claim.claimant_organization ? ` · ${claim.claimant_organization}` : ""}
            </dd>
            <dt>E-mail</dt>
            <dd>
              <a href={`mailto:${claim.claimant_email}`} className="text-link">
                {claim.claimant_email}
              </a>
            </dd>
            <dt>Acting as</dt>
            <dd>{CAPACITY_LABELS[claim.capacity] ?? claim.capacity}</dd>
            <dt>Claim about</dt>
            <dd>{CLAIM_TYPE_LABELS[claim.claim_type] ?? claim.claim_type}</dd>
            <dt>Good-faith statement</dt>
            <dd>Confirmed by the claimant</dd>
            {decided && (
              <>
                <dt>Decided</dt>
                <dd>{formatDateTime(claim.decided_at)}</dd>
                <dt>Reason</dt>
                <dd>{claim.decision_note ?? "—"}</dd>
              </>
            )}
          </dl>
        </section>

        <section className="dash-card">
          <h2 className="section-title">Decision</h2>
          {decided ? (
            <>
              <p>
                This claim is <strong>{claim.status}</strong> and can no longer change.
              </p>
              {claim.status === "upheld" && (
                <>
                  <p>
                    Track:{" "}
                    {claim.track_id ? (
                      <Link href={`/catalog/tracks/${claim.track_id}`} className="text-link">
                        {track?.title ?? claim.track_id}
                      </Link>
                    ) : (
                      "deleted since"
                    )}
                    . Blocked file fingerprints still in force: <strong>{blockedCount ?? "—"}</strong>.
                  </p>
                  {otherUpheld > 1 && (
                    <Notice>This artist has {otherUpheld} upheld claims. Consider whether the account should be suspended.</Notice>
                  )}
                  {blockedCount ? (
                    <details className="history">
                      <summary>The claim was a mistake: lift the blocks</summary>
                      <ActionForm
                        action={liftClaimBlocks}
                        submitLabel="Lift the blocks"
                        pendingLabel="Lifting…"
                        tone="danger"
                        confirm="Lift the blocks? The same files can then be uploaded again. The track stays archived."
                      >
                        <input type="hidden" name="claimId" value={claim.id} />
                        <textarea name="reason" required minLength={3} maxLength={500} placeholder="Why? (kept in the audit log)" className="input-field" />
                      </ActionForm>
                      <p className="muted">The track stays archived. To put it back online, restore it from its catalog page.</p>
                    </details>
                  ) : null}
                </>
              )}
            </>
          ) : (
            <>
              {claim.status === "received" && (
                <ActionForm action={startClaimReview} submitLabel="Start the review" pendingLabel="Saving…" tone="secondary">
                  <input type="hidden" name="claimId" value={claim.id} />
                </ActionForm>
              )}

              <h3 style={{ marginTop: "var(--space-sm)" }}>Remove the track (claim upheld)</h3>
              <p className="muted">
                The track is archived and the fingerprints of its files are blocked, in one step. Nothing is deleted: storage, plays and
                history stay.
              </p>
              {track ? (
                <p>
                  Selected track:{" "}
                  <Link href={`/catalog/tracks/${track.id}`} className="text-link">
                    {track.title}
                  </Link>{" "}
                  by {artistLabel(track)} · <StatusBadge status={track.status} /> · {formatDuration(track.duration_seconds)} ·{" "}
                  {hashedCount} of {fileCount} file{fileCount === 1 ? "" : "s"} can be blocked
                  {fileCount > hashedCount ? " (the others have no fingerprint yet: run the audio backfill)" : ""}.
                </p>
              ) : (
                <p className="muted">No track selected. Search for it below, or paste its identifier.</p>
              )}
              <ActionForm
                action={upholdClaim}
                submitLabel="Remove the track and block its files"
                pendingLabel="Removing…"
                tone="danger"
                confirm="Archive this track and block its files? The claim cannot be changed afterwards."
              >
                <input type="hidden" name="claimId" value={claim.id} />
                <input
                  name="trackId"
                  required
                  defaultValue={track?.id ?? ""}
                  key={track?.id ?? "none"}
                  placeholder="Track identifier (uuid)"
                  className="input-field"
                />
                <textarea
                  name="note"
                  required
                  minLength={3}
                  maxLength={500}
                  placeholder="Why is the claim upheld? (kept in the audit log)"
                  className="input-field"
                />
              </ActionForm>

              <h3 style={{ marginTop: "var(--space-sm)" }}>Reject the claim</h3>
              <ActionForm action={rejectClaim} submitLabel="Reject the claim" pendingLabel="Saving…" tone="secondary" confirm="Reject this claim? It cannot be changed afterwards.">
                <input type="hidden" name="claimId" value={claim.id} />
                <textarea
                  name="note"
                  required
                  minLength={3}
                  maxLength={500}
                  placeholder="Why? (kept in the audit log; not sent to the claimant)"
                  className="input-field"
                />
              </ActionForm>

              <details className="history">
                <summary>The claimant withdrew the claim</summary>
                <ActionForm action={withdrawClaim} submitLabel="Mark as withdrawn" pendingLabel="Saving…" tone="secondary" confirm="Mark this claim as withdrawn? It cannot be changed afterwards.">
                  <input type="hidden" name="claimId" value={claim.id} />
                  <textarea name="note" maxLength={500} placeholder="Note (optional)" className="input-field" />
                </ActionForm>
              </details>
            </>
          )}
        </section>
      </div>

      <section className="section-gap">
        <h2 className="section-title">What the claimant says</h2>
        <dl className="kv">
          <dt>Track on Vynl</dt>
          <dd style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{claim.track_reference}</dd>
          <dt>Original work</dt>
          <dd style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{claim.original_work}</dd>
          <dt>Description</dt>
          <dd style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{claim.description}</dd>
        </dl>
        <p className="muted">Written by the claimant and unverified. Never reveal to the claimant who uploaded the track.</p>
      </section>

      {!decided && (
        <section className="section-gap">
          <h2 className="section-title">Find the track on Vynl</h2>
          <form method="get" action={`/claims/${claim.id}`} className="filters">
            <input type="search" name="q" defaultValue={search} placeholder="Part of the title" className="input-field input-field--sm filters__search" />
            <button type="submit" className="btn btn-secondary btn-sm">
              Search
            </button>
          </form>
          {search.length >= 2 && (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Title</th>
                    <th>Artist</th>
                    <th>Status</th>
                    <th>Length</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {trackResults.length === 0 && (
                    <tr>
                      <td colSpan={5} className="empty">
                        No track with this title.
                      </td>
                    </tr>
                  )}
                  {trackResults.map((result) => (
                    <tr key={result.id}>
                      <td className="cell-main">{result.title}</td>
                      <td>{artistLabel(result)}</td>
                      <td>
                        <StatusBadge status={result.status} />
                      </td>
                      <td>{formatDuration(result.duration_seconds)}</td>
                      <td>
                        <Link href={`/claims/${claim.id}?q=${encodeURIComponent(search)}&track=${result.id}`} className="btn btn-secondary btn-sm">
                          Select
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      <section className="section-gap">
        <h2 className="section-title">Admin activity on this claim</h2>
        <AuditTrail targetType="rights_claim" targetId={claim.id} />
      </section>
    </>
  );
}
