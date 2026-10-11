import Link from "next/link";
import { FilterPills } from "@/components/FilterPills";
import { Notice } from "@/components/Notice";
import { PageHead } from "@/components/PageHead";
import { Pager } from "@/components/Pager";
import { StatusBadge } from "@/components/StatusBadge";
import { formatDate, formatDuration } from "@/lib/format";
import { embeddedCount, escapeLike, first, isUuid, oneOf, pageRange, parsePage, pick, type SearchParams } from "@/lib/query";
import { requireAdmin } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase/admin";

const VIEWS = ["tracks", "albums"] as const;
const STATUSES = ["draft", "in_review", "published", "archived"] as const;

interface TrackRow {
  id: string;
  catalog_code: string | null;
  title: string;
  status: string;
  explicit: boolean;
  duration_seconds: number | null;
  published_at: string | null;
  created_at: string;
  artists: { id: string; name: string } | { id: string; name: string }[] | null;
  albums: { title: string } | { title: string }[] | null;
  track_files: { count: number }[];
  ai_declarations: { status: string; provenance: string }[] | null;
}

interface AlbumRow {
  id: string;
  catalog_code: string | null;
  title: string;
  type: string;
  status: string;
  release_date: string | null;
  created_at: string;
  artists: { id: string; name: string } | { id: string; name: string }[] | null;
  tracks: { count: number }[];
}

export default async function CatalogPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireAdmin();

  const params = await searchParams;
  const view = oneOf(pick(params, "view"), VIEWS) ?? "tracks";
  const status = oneOf(pick(params, "status"), STATUSES);
  const artistParam = pick(params, "artist");
  const artist = isUuid(artistParam) ? artistParam : "";
  const q = pick(params, "q");
  const page = parsePage(params);
  const [from, to] = pageRange(page);

  const db = supabaseAdmin();
  const head = { count: "exact", head: true } as const;

  // Mêmes filtres (artiste) pour la liste et pour les compteurs des pastilles.
  const countFor = (value?: string) => {
    let countQuery = db.from(view).select("id", head);
    if (artist) countQuery = countQuery.eq("artist_id", artist);
    if (value) countQuery = countQuery.eq("status", value);
    return countQuery;
  };

  let listQuery =
    view === "tracks"
      ? db
          .from("tracks")
          .select(
            "id, catalog_code, title, status, explicit, duration_seconds, published_at, created_at, artists(id, name), albums(title), track_files(count), ai_declarations(status, provenance)",
            { count: "exact" }
          )
      : db
          .from("albums")
          .select("id, catalog_code, title, type, status, release_date, created_at, artists(id, name), tracks(count)", {
            count: "exact",
          });
  listQuery = listQuery.order("created_at", { ascending: false }).range(from, to);
  if (artist) listQuery = listQuery.eq("artist_id", artist);
  if (status) listQuery = listQuery.eq("status", status);
  if (q) listQuery = listQuery.ilike("title", `%${escapeLike(q)}%`);

  const [list, all, ...perStatus] = await Promise.all([listQuery, countFor(), ...STATUSES.map((value) => countFor(value))]);
  const artistRow = artist ? await db.from("artists").select("name").eq("id", artist).maybeSingle() : null;

  const filters = { view, status, artist, q };
  const forPills = { view, artist, q };

  return (
    <>
      <PageHead title="Catalog" />

      <FilterPills
        basePath="/catalog"
        param="view"
        current={view}
        params={{ artist, q }}
        options={[
          { label: "Tracks", value: "tracks" },
          { label: "Albums", value: "albums" },
        ]}
      />

      {artist && (
        <p className="muted" style={{ marginBottom: "var(--space-sm)" }}>
          Artist: <strong style={{ color: "var(--vynl-texte)" }}>{artistRow?.data?.name ?? artist}</strong>{" "}
          <Link href={`/catalog?view=${view}`} className="text-link">
            Clear
          </Link>
        </p>
      )}

      <FilterPills
        basePath="/catalog"
        param="status"
        current={status ?? ""}
        params={forPills}
        options={[
          { label: "All", value: "", count: all.error ? null : all.count },
          ...STATUSES.map((value, index) => ({
            label: value.replace("_", " "),
            value,
            count: perStatus[index].error ? null : perStatus[index].count,
          })),
        ]}
      />

      <form method="get" action="/catalog" className="filters">
        <input type="hidden" name="view" value={view} />
        {status && <input type="hidden" name="status" value={status} />}
        {artist && <input type="hidden" name="artist" value={artist} />}
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder={view === "tracks" ? "Search by track title" : "Search by album title"}
          className="input-field input-field--sm filters__search"
        />
        <button type="submit" className="btn btn-secondary btn-sm">
          Apply
        </button>
        {q && (
          <Link href={`/catalog?${new URLSearchParams({ view, ...(status ? { status } : {}), ...(artist ? { artist } : {}) })}`} className="text-link">
            Reset
          </Link>
        )}
      </form>

      {list.error && <Notice>Could not load the catalog: {list.error.message}</Notice>}

      <div className="table-wrap">
        {view === "tracks" ? (
          <table className="table">
            <thead>
              <tr>
                <th>Number</th>
                <th>Title</th>
                <th>Artist</th>
                <th>Album</th>
                <th>Status</th>
                <th>AI declaration</th>
                <th className="num">Duration</th>
                <th className="num">Files</th>
                <th>Published</th>
              </tr>
            </thead>
            <tbody>
              {(list.data ?? []).length === 0 && (
                <tr>
                  <td colSpan={9} className="empty">
                    No tracks match.
                  </td>
                </tr>
              )}
              {((list.data ?? []) as unknown as TrackRow[]).map((track) => {
                const trackArtist = first(track.artists);
                const declaration = track.ai_declarations?.[0];
                return (
                  <tr key={track.id}>
                    <td className="muted">{track.catalog_code ?? "—"}</td>
                    <td className="cell-main">
                      <Link href={`/catalog/tracks/${track.id}`} className="text-link">
                        {track.title}
                      </Link>
                      {track.explicit && <span className="badge" style={{ marginLeft: "0.5rem" }}>E</span>}
                    </td>
                    <td>
                      {trackArtist ? (
                        <Link href={`/catalog?artist=${trackArtist.id}`} className="text-link">
                          {trackArtist.name}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="cell-main">{first(track.albums)?.title ?? <span className="muted">Single</span>}</td>
                    <td>
                      <StatusBadge status={track.status} />
                    </td>
                    <td>
                      {declaration ? (
                        <span style={{ display: "inline-flex", gap: "0.4rem", alignItems: "center" }}>
                          {declaration.provenance} {declaration.status === "rejected" && <StatusBadge status="rejected" />}
                        </span>
                      ) : (
                        <span className="muted">None</span>
                      )}
                    </td>
                    <td className="num">{formatDuration(track.duration_seconds)}</td>
                    <td className="num">{embeddedCount(track.track_files)}</td>
                    <td>{formatDate(track.published_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Number</th>
                <th>Title</th>
                <th>Artist</th>
                <th>Type</th>
                <th>Status</th>
                <th className="num">Tracks</th>
                <th>Release date</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {(list.data ?? []).length === 0 && (
                <tr>
                  <td colSpan={8} className="empty">
                    No albums match.
                  </td>
                </tr>
              )}
              {((list.data ?? []) as unknown as AlbumRow[]).map((album) => {
                const albumArtist = first(album.artists);
                return (
                  <tr key={album.id}>
                    <td className="muted">{album.catalog_code ?? "—"}</td>
                    <td className="cell-main">
                      <Link href={`/catalog/albums/${album.id}`} className="text-link">
                        {album.title}
                      </Link>
                    </td>
                    <td>
                      {albumArtist ? (
                        <Link href={`/catalog?view=albums&artist=${albumArtist.id}`} className="text-link">
                          {albumArtist.name}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>{album.type}</td>
                    <td>
                      <StatusBadge status={album.status} />
                    </td>
                    <td className="num">{embeddedCount(album.tracks)}</td>
                    <td>{formatDate(album.release_date)}</td>
                    <td>{formatDate(album.created_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <Pager basePath="/catalog" params={filters} page={page} total={list.count ?? 0} />

      <p className="muted section-gap">Open a track or an album to review it, publish it, or take it down.</p>
    </>
  );
}
