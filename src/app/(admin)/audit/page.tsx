import Link from "next/link";
import { FilterPills } from "@/components/FilterPills";
import { Notice } from "@/components/Notice";
import { PageHead } from "@/components/PageHead";
import { Pager } from "@/components/Pager";
import { StatusBadge } from "@/components/StatusBadge";
import { formatDateTime } from "@/lib/format";
import { oneOf, pageRange, parsePage, pick, type SearchParams } from "@/lib/query";
import { requireAdmin } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase/admin";

const GROUPS = ["user", "track", "album", "ai_declaration", "play", "fraud_event"] as const;

interface Entry {
  id: string;
  created_at: string;
  admin_email: string;
  action: string;
  target_type: string;
  target_id: string | null;
  target_label: string | null;
  outcome: string;
  error: string | null;
  details: { reason?: string; note?: string; from?: string; to?: string; track_id?: string } | null;
}

function targetHref(entry: Entry): string | null {
  if (!entry.target_id) return null;
  switch (entry.target_type) {
    case "user":
      return `/users/${entry.target_id}`;
    case "track":
      return `/catalog/tracks/${entry.target_id}`;
    case "album":
      return `/catalog/albums/${entry.target_id}`;
    case "ai_declaration":
      return entry.details?.track_id ? `/catalog/tracks/${entry.details.track_id}` : null;
    case "play":
      return `/plays/${entry.target_id}`;
    case "fraud_event":
      return `/fraud/${entry.target_id}`;
    default:
      return null;
  }
}

export default async function AuditPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireAdmin();

  const params = await searchParams;
  const group = oneOf(pick(params, "group"), GROUPS);
  const page = parsePage(params);
  const [from, to] = pageRange(page);

  let query = supabaseAdmin()
    .from("admin_audit_log")
    .select("id, created_at, admin_email, action, target_type, target_id, target_label, outcome, error, details", {
      count: "exact",
    })
    .order("created_at", { ascending: false })
    .range(from, to);
  if (group) query = query.eq("target_type", group);

  const { data, error, count } = await query;
  const rows = (data ?? []) as unknown as Entry[];

  return (
    <>
      <PageHead title="Audit log" />

      <p className="muted" style={{ marginBottom: "var(--space-sm)" }}>
        Every action taken in this admin, recorded before it runs. Entries cannot be edited or deleted.
      </p>

      <FilterPills
        basePath="/audit"
        param="group"
        current={group ?? ""}
        params={{}}
        options={[
          { label: "All", value: "" },
          { label: "Users", value: "user" },
          { label: "Tracks", value: "track" },
          { label: "Albums", value: "album" },
          { label: "AI declarations", value: "ai_declaration" },
          { label: "Plays", value: "play" },
          { label: "Fraud events", value: "fraud_event" },
        ]}
      />

      {error && (
        <Notice>
          The audit log is not available: {error.message}. Apply supabase/migrations/20261010100000_admin_actions.sql in the
          Supabase SQL editor.
        </Notice>
      )}

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>When</th>
              <th>Admin</th>
              <th>Action</th>
              <th>Target</th>
              <th>Change</th>
              <th>Reason</th>
              <th>Result</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="empty">
                  No admin action recorded yet.
                </td>
              </tr>
            )}
            {rows.map((entry) => {
              const href = targetHref(entry);
              const label = entry.target_label ?? entry.target_id ?? "—";
              return (
                <tr key={entry.id}>
                  <td>{formatDateTime(entry.created_at)}</td>
                  <td className="cell-main">{entry.admin_email}</td>
                  <td>{entry.action}</td>
                  <td className="cell-main">
                    {href ? (
                      <Link href={href} className="text-link">
                        {label}
                      </Link>
                    ) : (
                      label
                    )}
                  </td>
                  <td>{entry.details?.from && entry.details?.to ? `${entry.details.from} → ${entry.details.to}` : "—"}</td>
                  <td className="cell-main">{entry.details?.reason ?? entry.details?.note ?? "—"}</td>
                  <td>
                    <StatusBadge status={entry.outcome === "success" ? "approved" : entry.outcome === "failed" ? "failed" : "pending"} />
                    {entry.error && <span className="muted"> {entry.error}</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Pager basePath="/audit" params={{ group }} page={page} total={count ?? 0} />
    </>
  );
}
