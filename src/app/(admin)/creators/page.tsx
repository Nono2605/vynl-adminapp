import Link from "next/link";
import { decideArtistName, setArtistVerified } from "@/app/actions/artists";
import { ActionForm } from "@/components/ActionForm";
import { FilterPills } from "@/components/FilterPills";
import { Notice } from "@/components/Notice";
import { PageHead } from "@/components/PageHead";
import { Pager } from "@/components/Pager";
import { ScanTable } from "@/components/ScanTable";
import { StatCard } from "@/components/StatCard";
import { StatusBadge } from "@/components/StatusBadge";
import { isMissingColumn, similarNames } from "@/lib/artistNames";
import { formatDate } from "@/lib/format";
import { embeddedCount, escapeLike, first, oneOf, pageRange, parsePage, pick, type SearchParams } from "@/lib/query";
import { SCAN_COLUMNS, type ScanRow } from "@/lib/scans";
import { requireAdmin } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase/admin";

const VERIFIED = ["yes", "no"] as const;

interface Onboarding {
  content_provenance: string;
  owns_rights: boolean;
}

interface ArtistRow {
  id: string;
  catalog_code: string | null;
  user_id: string | null;
  name: string;
  slug: string;
  country: string | null;
  verified: boolean;
  /** Absents tant que la migration de la relecture des noms n'est pas appliquée. */
  name_status?: string;
  name_review_note?: string | null;
  created_at: string;
  users: { email: string; creator_onboarding: Onboarding | Onboarding[] | null } | { email: string; creator_onboarding: Onboarding | Onboarding[] | null }[] | null;
  tracks: { count: number }[];
  albums: { count: number }[];
  follows: { count: number }[];
}

interface PendingArtist {
  id: string;
  catalog_code: string | null;
  user_id: string | null;
  name: string;
  created_at: string;
  users: { email: string } | { email: string }[] | null;
}

export default async function CreatorsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireAdmin();

  const params = await searchParams;
  const q = pick(params, "q");
  const verified = oneOf(pick(params, "verified"), VERIFIED);
  const page = parsePage(params);
  const [from, to] = pageRange(page);

  const db = supabaseAdmin();
  const head = { count: "exact", head: true } as const;

  const ARTIST_COLUMNS =
    "id, catalog_code, user_id, name, slug, country, verified, created_at, users(email, creator_onboarding(content_provenance, owns_rights)), tracks(count), albums(count), follows(count)";
  const listArtists = (withReview: boolean) => {
    let query = db
      .from("artists")
      .select(withReview ? `${ARTIST_COLUMNS}, name_status, name_review_note` : ARTIST_COLUMNS, { count: "exact" })
      .order("created_at", { ascending: false })
      .range(from, to);
    if (q) query = query.ilike("name", `%${escapeLike(q)}%`);
    if (verified) query = query.eq("verified", verified === "yes");
    return query;
  };

  const [firstList, creatorAccounts, artistProfiles, verifiedArtists, unverifiedArtists] = await Promise.all([
    listArtists(true),
    db.from("users").select("id", head).eq("role", "creator"),
    db.from("artists").select("id", head),
    db.from("artists").select("id", head).eq("verified", true),
    db.from("artists").select("id", head).eq("verified", false),
  ]);
  // Sans la migration de la relecture des noms (API/supabase/migrations/20261017000000_artist_name_review.sql),
  // les colonnes manquent : on relit sans elles, et la section « Names to review » est absente.
  let list = firstList;
  let reviewAvailable = true;
  if (list.error && isMissingColumn(list.error)) {
    list = await listArtists(false);
    reviewAvailable = false;
  }

  // Les artistes dont le nom attend une décision : leur page n'est pas publique tant qu'on n'a pas tranché.
  let pending: PendingArtist[] = [];
  let pendingScans: ScanRow[] = [];
  if (reviewAvailable) {
    const pendingQuery = await db
      .from("artists")
      .select("id, catalog_code, user_id, name, created_at, users(email)")
      .eq("name_status", "pending")
      .order("created_at", { ascending: true })
      .limit(50);
    pending = pendingQuery.error ? [] : (pendingQuery.data as unknown as PendingArtist[]);
    if (pending.length > 0) {
      const pendingScanQuery = await db
        .from("track_scans")
        .select(SCAN_COLUMNS)
        .eq("check_kind", "name_similarity")
        .is("decision", null)
        .in(
          "artist_id",
          pending.map((artist) => artist.id)
        );
      pendingScans = pendingScanQuery.error ? [] : (pendingScanQuery.data as unknown as ScanRow[]);
    }
  }
  const pendingIds = new Set(pending.map((artist) => artist.id));

  // Noms proches d'un nom existant, signalés à la création et pas encore relus (journal des contrôles de
  // l'API). Sans la migration, la table n'existe pas : la section est simplement absente.
  const nameScanQuery = await db
    .from("track_scans")
    .select(SCAN_COLUMNS)
    .eq("check_kind", "name_similarity")
    .is("decision", null)
    .order("created_at", { ascending: false })
    .limit(20);
  // Les artistes en attente de décision ont leur propre section ci-dessus : pas de doublon ici.
  const nameScans = ((nameScanQuery.error ? [] : nameScanQuery.data) as unknown as ScanRow[]).filter(
    (scan) => !(scan.artist_id && pendingIds.has(scan.artist_id))
  );
  const scanArtistIds = [
    ...new Set(nameScans.flatMap((scan) => [scan.artist_id, scan.matched_artist_id]).filter((id): id is string => !!id)),
  ];
  const scanArtists =
    scanArtistIds.length > 0 ? await db.from("artists").select("id, name").in("id", scanArtistIds) : { data: [] };
  const artistNames = new Map(((scanArtists.data ?? []) as { id: string; name: string }[]).map((a) => [a.id, a.name] as const));

  const rows = (list.data ?? []) as unknown as ArtistRow[];
  const count = (result: { count: number | null; error: { message: string } | null }) =>
    result.error ? null : result.count;
  const filters = { q, verified };

  return (
    <>
      <PageHead title="Creators" />

      <div className="stat-grid">
        <StatCard label="Creator accounts" value={count(creatorAccounts)} />
        <StatCard label="Artist profiles" value={count(artistProfiles)} />
        <StatCard label="Verified" value={count(verifiedArtists)} />
        {reviewAvailable && <StatCard label="Names to review" value={pending.length} />}
      </div>

      {pending.length > 0 && (
        <section className="section-gap">
          <h2 className="section-title">Names to review ({pending.length})</h2>
          <p className="muted" style={{ marginBottom: "var(--space-sm)" }}>
            These artists chose a name close to an existing one. Until you decide, their page is not public and they
            cannot submit music for review. Approve a name that is not an imitation; decline one that is, with a reason
            the artist will read. An approved name is permanent.
          </p>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Artist</th>
                  <th>Close to</th>
                  <th>Joined</th>
                  <th>Decision</th>
                </tr>
              </thead>
              <tbody>
                {pending.map((artist) => {
                  const account = first(artist.users);
                  const close = similarNames(pendingScans.filter((scan) => scan.artist_id === artist.id));
                  return (
                    <tr key={artist.id}>
                      <td className="cell-main">
                        {artist.name}
                        {artist.catalog_code && <span className="muted"> · {artist.catalog_code}</span>}
                        <br />
                        {artist.user_id && account ? (
                          <Link href={`/users/${artist.user_id}`} className="text-link">
                            {account.email}
                          </Link>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td>
                        {close.length === 0
                          ? "—"
                          : close
                              .map((match) => (match.score === null ? match.name : `${match.name} (${match.score.toFixed(2)})`))
                              .join(", ")}
                      </td>
                      <td>{formatDate(artist.created_at)}</td>
                      <td>
                        <details className="history">
                          <summary>Decide</summary>
                          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)", marginTop: "var(--space-xs)" }}>
                            <ActionForm
                              action={decideArtistName}
                              submitLabel="Approve name"
                              pendingLabel="Saving…"
                              tone="secondary"
                              confirm="Approve this name? It becomes permanent and the artist page becomes public."
                            >
                              <input type="hidden" name="artistId" value={artist.id} />
                              <input type="hidden" name="decision" value="approved" />
                              <input name="note" maxLength={500} placeholder="Optional note (kept in the audit log)" className="input-field input-field--sm" />
                            </ActionForm>
                            <ActionForm
                              action={decideArtistName}
                              submitLabel="Decline name"
                              pendingLabel="Saving…"
                              tone="danger"
                              confirm="Decline this name? The artist will read your reason and choose another name."
                            >
                              <input type="hidden" name="artistId" value={artist.id} />
                              <input type="hidden" name="decision" value="rejected" />
                              <input name="note" required minLength={3} maxLength={500} placeholder="Reason, shown to the artist" className="input-field input-field--sm" />
                            </ActionForm>
                          </div>
                        </details>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {nameScans.length > 0 && (
        <section className="section-gap">
          <h2 className="section-title">Names to check ({nameScans.length})</h2>
          <p className="muted" style={{ marginBottom: "var(--space-sm)" }}>
            These artists chose a name close to an existing one when they signed up. Several artists can share a name:
            check for the imitation of a known artist.
          </p>
          <ScanTable scans={nameScans} artistNames={artistNames} />
        </section>
      )}

      <div className="section-gap" />
      <FilterPills
        basePath="/creators"
        param="verified"
        current={verified ?? ""}
        params={{ q }}
        options={[
          { label: "All", value: "", count: count(artistProfiles) },
          { label: "Verified", value: "yes", count: count(verifiedArtists) },
          { label: "Not verified", value: "no", count: count(unverifiedArtists) },
        ]}
      />

      <form method="get" action="/creators" className="filters">
        {verified && <input type="hidden" name="verified" value={verified} />}
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Search by artist name"
          className="input-field input-field--sm filters__search"
        />
        <button type="submit" className="btn btn-secondary btn-sm">
          Apply
        </button>
        {q && (
          <Link href={verified ? `/creators?verified=${verified}` : "/creators"} className="text-link">
            Reset
          </Link>
        )}
      </form>

      {list.error && <Notice>Could not load artists: {list.error.message}</Notice>}

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Artist</th>
              <th>Account</th>
              <th>Verified</th>
              <th>Provenance</th>
              <th>Country</th>
              <th className="num">Tracks</th>
              <th className="num">Albums</th>
              <th className="num">Followers</th>
              <th>Joined</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={9} className="empty">
                  No artists match.
                </td>
              </tr>
            )}
            {rows.map((artist) => {
              const account = first(artist.users);
              const onboarding = first(account?.creator_onboarding);
              return (
                <tr key={artist.id}>
                  <td className="cell-main">
                    <Link href={`/catalog?artist=${artist.id}`} className="text-link">
                      {artist.name}
                    </Link>{" "}
                    {artist.name_status && artist.name_status !== "approved" && (
                      <>
                        <StatusBadge status={artist.name_status} />{" "}
                      </>
                    )}
                    <span className="muted">
                      /{artist.slug}
                      {artist.catalog_code ? ` · ${artist.catalog_code}` : ""}
                    </span>
                  </td>
                  <td className="cell-main">
                    {artist.user_id && account ? (
                      <Link href={`/users/${artist.user_id}`} className="text-link">
                        {account.email}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td>
                    {artist.verified ? <StatusBadge status="approved" /> : <span className="muted">No</span>}
                    <details className="history">
                      <summary>{artist.verified ? "Remove" : "Verify"}</summary>
                      <div style={{ marginTop: "var(--space-xs)" }}>
                        <ActionForm
                          action={setArtistVerified}
                          submitLabel={artist.verified ? "Remove badge" : "Verify artist"}
                          pendingLabel="Saving…"
                          tone={artist.verified ? "danger" : "secondary"}
                          confirm={artist.verified ? "Remove the verified badge from this artist?" : "Give this artist the verified badge?"}
                        >
                          <input type="hidden" name="artistId" value={artist.id} />
                          <input type="hidden" name="verified" value={artist.verified ? "no" : "yes"} />
                          <input name="note" maxLength={500} placeholder="Optional note" className="input-field input-field--sm" />
                        </ActionForm>
                      </div>
                    </details>
                  </td>
                  <td>{onboarding?.content_provenance ?? "—"}</td>
                  <td>{artist.country ?? "—"}</td>
                  <td className="num">{embeddedCount(artist.tracks)}</td>
                  <td className="num">{embeddedCount(artist.albums)}</td>
                  <td className="num">{embeddedCount(artist.follows)}</td>
                  <td>{formatDate(artist.created_at)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Pager basePath="/creators" params={filters} page={page} total={list.count ?? 0} />

      <p className="muted section-gap">Earnings, wallets and Stripe KYC status arrive with the finance pages.</p>
    </>
  );
}
