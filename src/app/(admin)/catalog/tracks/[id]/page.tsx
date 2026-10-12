import Link from "next/link";
import { notFound } from "next/navigation";
import { reviewDeclaration, reviewTrack } from "@/app/actions/moderation";
import { ActionForm } from "@/components/ActionForm";
import { AuditTrail } from "@/components/AuditTrail";
import { Notice } from "@/components/Notice";
import { PageHead } from "@/components/PageHead";
import { ReviewFlowBar } from "@/components/ReviewFlow";
import { ScanTable } from "@/components/ScanTable";
import { StatusBadge } from "@/components/StatusBadge";
import { formatDate, formatDateTime, formatDuration } from "@/lib/format";
import { blockers, declarationState, sumSplits, trackChecks } from "@/lib/moderation";
import { first, isUuid, pick, type SearchParams } from "@/lib/query";
import { loadQueue, skipPath } from "@/lib/reviewQueue";
import { positionOf } from "@/lib/reviewQueueLogic";
import { SCAN_COLUMNS, isMissingTable, type ScanRow } from "@/lib/scans";
import { requireAdmin } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase/admin";

const AUDIO_BUCKET = "track-audio";
const SIGNED_URL_SECONDS = 3600;

interface FileRow {
  id: string;
  storage_key: string;
  format: string;
  quality_label: string;
  bitrate_kbps: number | null;
  file_size_bytes: number | null;
  duration_seconds: number | null;
  verified_at: string | null;
}

interface DeclarationRow {
  id: string;
  provenance: string;
  ai_tool_names: string[] | null;
  description: string | null;
  status: string;
  declared_at: string;
}

interface SplitRow {
  id: string;
  percentage: number | string;
  artists: { name: string } | { name: string }[] | null;
  rights: { rights_holder_name: string } | { rights_holder_name: string }[] | null;
}

function formatSize(bytes: number | null): string {
  if (bytes === null) return "—";
  return bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(Math.round(bytes / 1024), 1)} KB`;
}

export default async function TrackReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  await requireAdmin();

  const { id } = await params;
  if (!isUuid(id)) notFound();

  // ?flow=1 : mode file d'attente. Décider (accepter / refuser) ouvre l'élément suivant.
  const query = await searchParams;
  const flow = pick(query, "flow") === "1";

  const db = supabaseAdmin();

  const [track, files, declarations, splits, rights, rejection, notes] = await Promise.all([
    db
      .from("tracks")
      .select(
        "id, catalog_code, title, slug, status, explicit, track_number, duration_seconds, isrc, published_at, published_by, created_at, updated_at, artists(id, catalog_code, name, slug), albums(id, catalog_code, title)"
      )
      .eq("id", id)
      .maybeSingle(),
    db
      .from("track_files")
      .select("id, storage_key, format, quality_label, bitrate_kbps, file_size_bytes, duration_seconds, verified_at")
      .eq("track_id", id)
      .order("created_at", { ascending: true }),
    db
      .from("ai_declarations")
      .select("id, provenance, ai_tool_names, description, status, declared_at")
      .eq("track_id", id)
      .order("declared_at", { ascending: false }),
    db.from("splits").select("id, percentage, artists(name), rights(rights_holder_name)").eq("track_id", id),
    db
      .from("rights")
      .select("id, rights_holder_name, rights_holder_type, rights_type, territory")
      .eq("track_id", id),
    // Colonnes ajoutées par la migration des actions d'admin : lues à part pour
    // que la page marche aussi tant qu'elle n'est pas appliquée.
    db.from("tracks").select("rejection_reason").eq("id", id).maybeSingle(),
    db.from("ai_declarations").select("id, review_note").eq("track_id", id),
  ]);

  if (track.error) throw new Error(`Could not load the track: ${track.error.message}`);
  if (!track.data) notFound();

  const row = track.data as unknown as {
    id: string;
    catalog_code: string | null;
    title: string;
    slug: string;
    status: string;
    explicit: boolean;
    track_number: number | null;
    duration_seconds: number | null;
    isrc: string | null;
    published_at: string | null;
    published_by: string | null;
    created_at: string;
    updated_at: string;
    artists: { id: string; catalog_code: string | null; name: string; slug: string } | { id: string; catalog_code: string | null; name: string; slug: string }[] | null;
    albums: { id: string; catalog_code: string | null; title: string } | { id: string; catalog_code: string | null; title: string }[] | null;
  };
  const artist = first(row.artists);
  const album = first(row.albums);
  const fileRows = (files.data ?? []) as FileRow[];
  const declarationRows = (declarations.data ?? []) as DeclarationRow[];
  const splitRows = (splits.data ?? []) as unknown as SplitRow[];
  const rightsRows = (rights.data ?? []) as {
    id: string;
    rights_holder_name: string;
    rights_holder_type: string;
    rights_type: string;
    territory: string;
  }[];
  const reviewNotes = new Map(((notes.data ?? []) as { id: string; review_note: string | null }[]).map((n) => [n.id, n.review_note]));
  const rejectionReason = (rejection.data as { rejection_reason: string | null } | null)?.rejection_reason ?? null;

  const publisher = row.published_by
    ? (await db.from("users").select("email").eq("id", row.published_by).maybeSingle()).data?.email
    : null;

  // Écoute : lien signé de courte durée vers le plus ancien fichier (celui dont la
  // durée est enregistrée sur le morceau, comme pour la lecture dans l'app).
  let audioUrl: string | null = null;
  let audioError: string | null = null;
  if (fileRows[0]) {
    const signed = await db.storage.from(AUDIO_BUCKET).createSignedUrl(fileRows[0].storage_key, SIGNED_URL_SECONDS);
    if (signed.error) audioError = signed.error.message;
    else audioUrl = signed.data.signedUrl;
  }

  const checks = trackChecks({
    durationSeconds: row.duration_seconds,
    fileCount: fileRows.length,
    declaration: declarationState(declarationRows[0]),
    splitsTotal: sumSplits(splitRows),
  });
  const blocking = blockers(checks);
  const splitsTotal = sumSplits(splitRows);

  // Journal des contrôles de contenu : la table n'existe qu'après la migration de l'API, la page marche sans.
  const scanQuery = await db
    .from("track_scans")
    .select(SCAN_COLUMNS)
    .eq("track_id", id)
    .order("created_at", { ascending: false })
    .limit(50);
  const scansMissing = isMissingTable(scanQuery.error);
  const scanRows = (scanQuery.error ? [] : scanQuery.data) as unknown as ScanRow[];
  const scansError = scanQuery.error && !scansMissing ? scanQuery.error.message : null;

  const errors = [files, declarations, splits, rights]
    .map((result) => result.error?.message)
    .filter(Boolean);

  // Déclarations : la plus récente fait foi. Une déclaration identique à celle qui la suit
  // (plus récente) n'est qu'un « Save » répété : on la masque. Ne restent dans
  // l'historique que les vrais changements.
  // Un refus n'est jamais masqué : deux enregistrements identiques dont un seul est refusé restent visibles.
  const sameContent = (a: DeclarationRow, b: DeclarationRow) =>
    (a.status === "rejected") === (b.status === "rejected") &&
    a.provenance === b.provenance &&
    (a.description ?? null) === (b.description ?? null) &&
    JSON.stringify(a.ai_tool_names ?? null) === JSON.stringify(b.ai_tool_names ?? null);
  const latestDeclaration = declarationRows[0] ?? null;
  const earlierChanges = declarationRows.slice(1).filter((declaration, index) => !sameContent(declaration, declarationRows[index]));
  const resaves = declarationRows.length - (latestDeclaration ? 1 : 0) - earlierChanges.length;

  const declarationCard = (declaration: DeclarationRow, isLatest: boolean) => {
    const rejected = declaration.status === "rejected";
    const note = reviewNotes.get(declaration.id);
    return (
      <article key={declaration.id} className="dash-card">
        <div className="page-head" style={{ marginBottom: "var(--space-xs)" }}>
          <span style={{ display: "inline-flex", gap: "var(--space-xs)", alignItems: "center" }}>
            <strong>{declaration.provenance}</strong>
            {rejected && <StatusBadge status="rejected" />}
            {isLatest && <span className="muted">latest</span>}
          </span>
          <span className="muted">Declared {formatDateTime(declaration.declared_at)}</span>
        </div>
        <dl className="kv">
          <dt>AI tools</dt>
          <dd>{declaration.ai_tool_names?.length ? declaration.ai_tool_names.join(", ") : "—"}</dd>
          <dt>Description</dt>
          <dd>{declaration.description ?? "—"}</dd>
          {rejected && note && (
            <>
              <dt>Rejected because</dt>
              <dd>{note}</dd>
            </>
          )}
        </dl>
        {isLatest && (
          <div style={{ marginTop: "var(--space-sm)" }}>
            {rejected ? (
              <ActionForm action={reviewDeclaration} submitLabel="Withdraw the rejection" pendingLabel="Saving…" tone="secondary">
                <input type="hidden" name="declarationId" value={declaration.id} />
                <input type="hidden" name="decision" value="reinstate" />
              </ActionForm>
            ) : (
              <ActionForm
                action={reviewDeclaration}
                submitLabel="Reject declaration"
                pendingLabel="Saving…"
                tone="danger"
                confirm="Reject this declaration? The track cannot be published as declared."
              >
                <input type="hidden" name="declarationId" value={declaration.id} />
                <input type="hidden" name="decision" value="reject" />
                <textarea
                  name="note"
                  required
                  minLength={3}
                  maxLength={500}
                  placeholder="Why is it rejected? (the creator can read it)"
                  className="input-field"
                />
              </ActionForm>
            )}
          </div>
        )}
      </article>
    );
  };

  // La file n'est lue qu'en mode file d'attente.
  const queue = flow ? await loadQueue("tracks") : null;

  return (
    <>
      {flow ? (
        <p className="muted">
          <Link href="/moderation" className="text-link">
            Moderation
          </Link>{" "}
          / tracks in review / {row.title}
        </p>
      ) : (
        <p className="muted">
          <Link href="/catalog" className="text-link">
            Catalog
          </Link>{" "}
          / {row.title}
        </p>
      )}

      {flow && queue && (
        <ReviewFlowBar
          kind="tracks"
          currentId={row.id}
          position={positionOf(queue.ids, row.id)}
          total={queue.total}
          lastDecision={pick(query, "last")}
          lastTitle={pick(query, "lastTitle")}
        />
      )}
      {flow && row.status !== "in_review" && (
        <Notice>
          This track is no longer waiting for review.{" "}
          <Link href={skipPath("tracks", row.id)} prefetch={false} className="text-link">
            Open the next one
          </Link>
        </Notice>
      )}
      <PageHead title={row.title} plain>
        <span style={{ display: "inline-flex", gap: "var(--space-xs)" }}>
          <StatusBadge status={row.status} />
          {row.explicit && <span className="badge">Explicit</span>}
        </span>
      </PageHead>

      {errors.length > 0 && <Notice>Some sections could not be loaded: {errors[0]}</Notice>}

      {rejectionReason && (
        <p className="review-reason">
          <strong>Last {row.status === "archived" ? "take-down" : "refusal"} reason:</strong> {rejectionReason}
        </p>
      )}

      <div className="decision-grid">
        <section className="dash-card dash-card--featured">
          <h2 className="section-title">Review checklist</h2>
          <ul className="checklist">
            {checks.map((check) => (
              <li key={check.key}>
                <span className="checklist__label">{check.label}</span>
                <span className={`status status--${check.state === "ok" ? "ok" : check.state === "warn" ? "warn" : "error"}`}>
                  {check.state === "ok" ? "OK" : check.state === "warn" ? "Check" : "Blocked"}
                </span>
                <span className="checklist__detail">{check.detail}</span>
              </li>
            ))}
            <li>
              <span className="checklist__label">Copyright scan</span>
              <span className="status status--soon">Coming</span>
              <span className="checklist__detail">Audio fingerprinting against known catalogs will appear here.</span>
            </li>
          </ul>
          <p className="muted" style={{ marginTop: "var(--space-sm)" }}>
            Listen to the track and read the declaration before deciding.
          </p>
        </section>

        <section className="dash-card">
          <h2 className="section-title">Decision</h2>
          {row.status === "in_review" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)" }}>
              {blocking.length > 0 ? (
                <Notice>
                  It cannot be published yet: {blocking.map((check) => check.label.toLowerCase()).join(", ")}.
                </Notice>
              ) : (
                <ActionForm
                  action={reviewTrack}
                  submitLabel="Approve and publish"
                  pendingLabel="Publishing…"
                  confirm={flow ? undefined : `Publish "${row.title}"? It becomes visible to every listener.`}
                >
                  <input type="hidden" name="trackId" value={row.id} />
                  <input type="hidden" name="decision" value="approve" />
                  {flow && <input type="hidden" name="flow" value="1" />}
                </ActionForm>
              )}
              <div>
                <h3 className="subsection-title">Refuse</h3>
                <ActionForm
                  action={reviewTrack}
                  submitLabel="Refuse and send back"
                  pendingLabel="Sending…"
                  tone="danger"
                  confirm={flow ? undefined : `Send "${row.title}" back to draft? The creator will see your reason.`}
                >
                  <input type="hidden" name="trackId" value={row.id} />
                  <input type="hidden" name="decision" value="refuse" />
                  {flow && <input type="hidden" name="flow" value="1" />}
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
              action={reviewTrack}
              submitLabel="Take down (archive)"
              pendingLabel="Archiving…"
              tone="danger"
              confirm={`Archive "${row.title}"? It disappears for listeners. A published track can never go back to draft.`}
            >
              <input type="hidden" name="trackId" value={row.id} />
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
            (blocking.length > 0 ? (
              <Notice>It cannot be restored yet: {blocking.map((check) => check.label.toLowerCase()).join(", ")}.</Notice>
            ) : (
              <ActionForm
                action={reviewTrack}
                submitLabel="Restore (publish again)"
                pendingLabel="Restoring…"
                confirm={`Publish "${row.title}" again?`}
              >
                <input type="hidden" name="trackId" value={row.id} />
                <input type="hidden" name="decision" value="restore" />
              </ActionForm>
            ))}

          {row.status === "draft" && (
            <p className="muted">This track is a draft: it is waiting for the creator to submit it for review.</p>
          )}
        </section>
      </div>

      <section className="dash-card section-gap">
        <h2 className="section-title">Listen</h2>
        {audioUrl ? (
          <audio controls preload="none" src={audioUrl}>
            Your browser does not support audio playback.
          </audio>
        ) : (
          <p className="muted">{audioError ? `Audio preview unavailable: ${audioError}` : "No audio file uploaded."}</p>
        )}
        {fileRows.length > 0 && (
          <div className="table-wrap" style={{ marginTop: "var(--space-sm)" }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Format</th>
                  <th>Quality</th>
                  <th className="num">Bitrate</th>
                  <th className="num">Size</th>
                  <th className="num">Duration</th>
                  <th>Verified</th>
                </tr>
              </thead>
              <tbody>
                {fileRows.map((file) => (
                  <tr key={file.id}>
                    <td>{file.format}</td>
                    <td>{file.quality_label}</td>
                    <td className="num">{file.bitrate_kbps ? `${file.bitrate_kbps} kbps` : "—"}</td>
                    <td className="num">{formatSize(file.file_size_bytes)}</td>
                    <td className="num">{formatDuration(file.duration_seconds)}</td>
                    <td>{file.verified_at ? formatDate(file.verified_at) : "No"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="two-col section-gap">
        <section className="dash-card">
          <h2 className="section-title">Details</h2>
          <dl className="kv">
            <dt>Catalog number</dt>
            <dd>{row.catalog_code ?? "—"}</dd>
            <dt>Artist</dt>
            <dd>
              {artist ? (
                <>
                  <Link href={`/catalog?artist=${artist.id}`} className="text-link">
                    {artist.name}
                  </Link>{" "}
                  <span className="muted">{artist.catalog_code}</span>
                </>
              ) : (
                "—"
              )}
            </dd>
            <dt>Album</dt>
            <dd>
              {album ? (
                <>
                  <Link href={`/catalog/albums/${album.id}`} className="text-link">
                    {album.title}
                  </Link>{" "}
                  <span className="muted">{album.catalog_code}</span>
                </>
              ) : (
                "Single"
              )}
            </dd>
            <dt>Track number</dt>
            <dd>{row.track_number ?? "—"}</dd>
            <dt>Duration</dt>
            <dd>{formatDuration(row.duration_seconds)}</dd>
            <dt>ISRC</dt>
            <dd>{row.isrc ?? "—"}</dd>
            <dt>Created</dt>
            <dd>{formatDateTime(row.created_at)}</dd>
            <dt>Last update</dt>
            <dd>{formatDateTime(row.updated_at)}</dd>
            <dt>Published</dt>
            <dd>
              {row.published_at ? `${formatDateTime(row.published_at)}${publisher ? ` by ${publisher}` : ""}` : "Never"}
            </dd>
          </dl>
        </section>

        <section className="dash-card">
          <h2 className="section-title">Rights and splits</h2>
          {rightsRows.length === 0 && splitRows.length === 0 ? (
            <p className="muted">No rights or splits recorded.</p>
          ) : (
            <>
              {rightsRows.length > 0 && (
                <ul className="checklist" style={{ marginBottom: "var(--space-sm)" }}>
                  {rightsRows.map((right) => (
                    <li key={right.id}>
                      <span className="checklist__label">{right.rights_holder_name}</span>
                      <span className="checklist__detail">
                        {right.rights_holder_type} · {right.rights_type} · {right.territory}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {splitRows.length > 0 && (
                <dl className="kv">
                  {splitRows.map((split) => (
                    <div key={split.id} style={{ display: "contents" }}>
                      <dt>{first(split.artists)?.name ?? first(split.rights)?.rights_holder_name ?? "—"}</dt>
                      <dd>{Number(split.percentage)}%</dd>
                    </div>
                  ))}
                  <dt>Total</dt>
                  <dd>
                    <strong>{splitsTotal === null ? "—" : `${Number(splitsTotal.toFixed(3))}%`}</strong>
                  </dd>
                </dl>
              )}
            </>
          )}
        </section>
      </div>

      <section className="section-gap">
        <h2 className="section-title">AI declarations</h2>
        <p className="muted" style={{ marginBottom: "var(--space-sm)" }}>
          Declared by the creator. No review is needed to publish. Reject the latest declaration only to block the track.
        </p>
        {latestDeclaration ? (
          declarationCard(latestDeclaration, true)
        ) : (
          <p className="muted">The creator has not declared how this track was made.</p>
        )}
        {earlierChanges.length > 0 && (
          <details className="history" style={{ marginTop: "var(--space-sm)" }}>
            <summary>Earlier declarations ({earlierChanges.length})</summary>
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)", marginTop: "var(--space-sm)" }}>
              {earlierChanges.map((declaration) => declarationCard(declaration, false))}
            </div>
          </details>
        )}
        {resaves > 0 && (
          <p className="muted" style={{ marginTop: "var(--space-xs)" }}>
            {resaves} identical re-save{resaves > 1 ? "s" : ""} hidden (the creator saved the same declaration again).
          </p>
        )}
      </section>

      <section className="section-gap">
        <h2 className="section-title">Content checks</h2>
        <p className="muted" style={{ marginBottom: "var(--space-sm)" }}>
          Every automatic check on this track is kept here as proof of diligence. A refused upload leaves a line too.
        </p>
        {scansError && <Notice>Could not load the checks: {scansError}</Notice>}
        {scansMissing ? (
          <p className="muted">The check log is not set up yet: apply the latest migration of the API repository.</p>
        ) : scanRows.length === 0 ? (
          <p className="muted">No check recorded for this track.</p>
        ) : (
          <ScanTable scans={scanRows} />
        )}
      </section>

      <section className="section-gap">
        <h2 className="section-title">Admin activity on this track</h2>
        <AuditTrail targetType="track" targetId={row.id} />
      </section>
    </>
  );
}
