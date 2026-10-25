import Link from "next/link";
import { ClaimStatusBadge } from "@/components/ClaimStatusBadge";
import { FilterPills } from "@/components/FilterPills";
import { Notice } from "@/components/Notice";
import { PageHead } from "@/components/PageHead";
import { Pager } from "@/components/Pager";
import { StatCard } from "@/components/StatCard";
import { formatDateTime } from "@/lib/format";
import { oneOf, pageRange, parsePage, pick, type SearchParams } from "@/lib/query";
import {
  CLAIM_RESPONSE_DAYS,
  CLAIM_TYPE_LABELS,
  DECIDED_STATUSES,
  OPEN_STATUSES,
  ageInDays,
  claimReference,
  isOverdue,
  repeatArtists,
} from "@/lib/rightsClaims";
import { isMissingTable } from "@/lib/scans";
import { requireAdmin } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase/admin";

const VIEWS = ["open", "decided"] as const;
const MIGRATION = "20261025000002_rights_claims.sql";

interface ClaimRow {
  id: string;
  claim_number: number;
  created_at: string;
  claimant_name: string;
  claimant_organization: string | null;
  claim_type: string;
  track_reference: string;
  status: string;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export default async function ClaimsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireAdmin();

  const params = await searchParams;
  const view = oneOf(pick(params, "view"), VIEWS) ?? "open";
  const page = parsePage(params);
  const [from, to] = pageRange(page);
  const now = new Date();

  const db = supabaseAdmin();
  const head = { count: "exact", head: true } as const;

  const [list, open, received, decided, upheld] = await Promise.all([
    db
      .from("rights_claims")
      .select("id, claim_number, created_at, claimant_name, claimant_organization, claim_type, track_reference, status", { count: "exact" })
      .in("status", view === "open" ? OPEN_STATUSES : DECIDED_STATUSES)
      // À traiter : les plus anciens d'abord (le délai de réponse court). Décidés : les plus récents d'abord.
      .order("created_at", { ascending: view === "open" })
      .range(from, to),
    db.from("rights_claims").select("id", head).in("status", OPEN_STATUSES),
    db.from("rights_claims").select("id", head).eq("status", "received"),
    db.from("rights_claims").select("id", head).in("status", DECIDED_STATUSES),
    db.from("rights_claims").select("artist_id, status").eq("status", "upheld").not("artist_id", "is", null).limit(1000),
  ]);

  if (isMissingTable(list.error)) {
    return (
      <>
        <PageHead title="Claims" />
        <Notice>
          The claims tables do not exist yet. Apply {MIGRATION} (API repository) in the Supabase SQL editor, then reload this page.
        </Notice>
      </>
    );
  }

  const rows = (list.data ?? []) as ClaimRow[];
  const count = (result: { count: number | null; error: unknown }) => (result.error ? null : result.count);

  // Les artistes visés par plusieurs signalements fondés : à examiner (suspension des récidivistes).
  const repeats = upheld.error ? [] : repeatArtists((upheld.data ?? []) as { artist_id: string | null; status: string }[]);
  const names = new Map<string, string>();
  if (repeats.length > 0) {
    const { data } = await db.from("artists").select("id, name, catalog_code").in("id", repeats.map((r) => r.artist_id));
    for (const artist of (data ?? []) as { id: string; name: string; catalog_code: string | null }[]) {
      names.set(artist.id, artist.catalog_code ? `${artist.name} (${artist.catalog_code})` : artist.name);
    }
  }
  const overdue = rows.filter((row) => isOverdue(row, now)).length;

  return (
    <>
      <PageHead title="Claims" />

      <div className="stat-grid">
        <StatCard label="Open claims" value={count(open)} warn />
        <StatCard label="Not looked at yet" value={count(received)} warn />
        <StatCard label="Decided" value={count(decided)} />
        <StatCard label="Artists with repeat claims" value={upheld.error ? null : repeats.length} warn />
      </div>

      <section className="dash-card section-gap">
        <h2 className="section-title">How claims work</h2>
        <p className="muted">
          Rights holders send claims through the form on the website (takedown page). Each claim gets a case number (RC-…).
          Opening a claim never removes anything by itself. <strong>Upholding</strong> a claim archives the track and blocks the
          fingerprints of its files so nobody can upload them again; nothing is deleted from storage, plays or history.{" "}
          <strong>Rejecting</strong> keeps your reason in the audit log only. An open claim is flagged as overdue after{" "}
          {CLAIM_RESPONSE_DAYS} days (provisional: the response time is to be set with counsel).
        </p>
      </section>

      <FilterPills
        basePath="/claims"
        param="view"
        current={view}
        params={{}}
        options={[
          { label: "Open", value: "open", count: count(open) },
          { label: "Decided", value: "decided", count: count(decided) },
        ]}
      />

      {list.error && <Notice>Could not load claims: {list.error.message}</Notice>}
      {view === "open" && overdue > 0 && <Notice>{overdue} claim{overdue === 1 ? " is" : "s are"} overdue on this page.</Notice>}

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Case</th>
              <th>Received</th>
              <th>Claimant</th>
              <th>About</th>
              <th>Track</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="empty">
                  {view === "open" ? "No open claim." : "No decided claim yet."}
                </td>
              </tr>
            )}
            {rows.map((claim) => (
              <tr key={claim.id}>
                <td className="cell-main">{claimReference(claim.claim_number)}</td>
                <td>
                  {formatDateTime(claim.created_at)}
                  {isOverdue(claim, now) && (
                    <>
                      {" "}
                      <span className="status status--error">overdue · {ageInDays(claim.created_at, now)} d</span>
                    </>
                  )}
                </td>
                <td className="cell-main">
                  {claim.claimant_name}
                  {claim.claimant_organization && <span className="muted"> · {claim.claimant_organization}</span>}
                </td>
                <td>{CLAIM_TYPE_LABELS[claim.claim_type] ?? claim.claim_type}</td>
                <td className="cell-main muted">{truncate(claim.track_reference, 60)}</td>
                <td>
                  <ClaimStatusBadge status={claim.status} />
                </td>
                <td>
                  <Link href={`/claims/${claim.id}`} className="btn btn-secondary btn-sm">
                    Open
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Pager basePath="/claims" params={{ view }} page={page} total={list.count ?? 0} />

      {repeats.length > 0 && (
        <>
          <h2 className="section-title section-gap">Artists with several upheld claims</h2>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Artist</th>
                  <th className="num">Upheld claims</th>
                </tr>
              </thead>
              <tbody>
                {repeats.map((repeat) => (
                  <tr key={repeat.artist_id}>
                    <td className="cell-main">
                      <Link href={`/catalog?artist=${repeat.artist_id}`} className="text-link">
                        {names.get(repeat.artist_id) ?? repeat.artist_id}
                      </Link>
                    </td>
                    <td className="num">{repeat.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted">Suspending an artist is a manual decision, taken from the Creators page.</p>
        </>
      )}
    </>
  );
}
