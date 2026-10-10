import { Notice } from "@/components/Notice";
import { StatusBadge } from "@/components/StatusBadge";
import { formatDateTime } from "@/lib/format";
import { supabaseAdmin } from "@/lib/supabase/admin";

interface Entry {
  id: string;
  created_at: string;
  admin_email: string;
  action: string;
  outcome: string;
  error: string | null;
  details: { reason?: string; note?: string; from?: string; to?: string } | null;
}

// Dernières actions d'admin sur une cible (fiche utilisateur, morceau, album).
// Si le journal n'existe pas encore (migration non appliquée), le dit au lieu
// de planter.
export async function AuditTrail({ targetType, targetId }: { targetType: string; targetId: string }) {
  const { data, error } = await supabaseAdmin()
    .from("admin_audit_log")
    .select("id, created_at, admin_email, action, outcome, error, details")
    .eq("target_type", targetType)
    .eq("target_id", targetId)
    .order("created_at", { ascending: false })
    .limit(10);

  if (error) {
    return <Notice>The audit log is not available: {error.message}. Apply the admin actions migration in Supabase.</Notice>;
  }

  const entries = (data ?? []) as Entry[];

  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>When</th>
            <th>Admin</th>
            <th>Action</th>
            <th>Change</th>
            <th>Reason</th>
            <th>Result</th>
          </tr>
        </thead>
        <tbody>
          {entries.length === 0 && (
            <tr>
              <td colSpan={6} className="empty">
                No admin action yet.
              </td>
            </tr>
          )}
          {entries.map((entry) => (
            <tr key={entry.id}>
              <td>{formatDateTime(entry.created_at)}</td>
              <td className="cell-main">{entry.admin_email}</td>
              <td>{entry.action}</td>
              <td>{entry.details?.from && entry.details?.to ? `${entry.details.from} → ${entry.details.to}` : "—"}</td>
              <td className="cell-main">{entry.details?.reason ?? entry.details?.note ?? "—"}</td>
              <td>
                <StatusBadge status={entry.outcome === "success" ? "approved" : entry.outcome === "failed" ? "failed" : "pending"} />
                {entry.error && <span className="muted"> {entry.error}</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
