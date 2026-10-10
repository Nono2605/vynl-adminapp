import Link from "next/link";
import { FilterPills } from "@/components/FilterPills";
import { Notice } from "@/components/Notice";
import { PageHead } from "@/components/PageHead";
import { Pager } from "@/components/Pager";
import { StatCard } from "@/components/StatCard";
import { StatusBadge } from "@/components/StatusBadge";
import { formatDate } from "@/lib/format";
import { embeddedCount, escapeLike, first, oneOf, pageRange, parsePage, pick, type SearchParams } from "@/lib/query";
import { requireAdmin } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase/admin";

const VERIFIED = ["yes", "no"] as const;

interface Onboarding {
  content_provenance: string;
  owns_rights: boolean;
}

interface ArtistRow {
  id: string;
  user_id: string | null;
  name: string;
  slug: string;
  country: string | null;
  verified: boolean;
  created_at: string;
  users: { email: string; creator_onboarding: Onboarding | Onboarding[] | null } | { email: string; creator_onboarding: Onboarding | Onboarding[] | null }[] | null;
  tracks: { count: number }[];
  albums: { count: number }[];
  follows: { count: number }[];
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

  let query = db
    .from("artists")
    .select(
      "id, user_id, name, slug, country, verified, created_at, users(email, creator_onboarding(content_provenance, owns_rights)), tracks(count), albums(count), follows(count)",
      { count: "exact" }
    )
    .order("created_at", { ascending: false })
    .range(from, to);
  if (q) query = query.ilike("name", `%${escapeLike(q)}%`);
  if (verified) query = query.eq("verified", verified === "yes");

  const [list, creatorAccounts, artistProfiles, verifiedArtists, unverifiedArtists] = await Promise.all([
    query,
    db.from("users").select("id", head).eq("role", "creator"),
    db.from("artists").select("id", head),
    db.from("artists").select("id", head).eq("verified", true),
    db.from("artists").select("id", head).eq("verified", false),
  ]);

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
      </div>

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
                    <span className="muted">/{artist.slug}</span>
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
                  <td>{artist.verified ? <StatusBadge status="approved" /> : <span className="muted">No</span>}</td>
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
