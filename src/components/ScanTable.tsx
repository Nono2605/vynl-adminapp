import Link from "next/link";
import { decideScan } from "@/app/actions/scans";
import { ActionForm } from "@/components/ActionForm";
import { StatusBadge } from "@/components/StatusBadge";
import { formatDateTime } from "@/lib/format";
import { describeScan, type ScanRow } from "@/lib/scans";

// Le journal des contrôles de contenu (spec 15.5). Avec `artistNames`, une colonne « Artist » s'ajoute
// (page des créateurs) ; sans, la liste est celle d'un seul morceau.
export function ScanTable({ scans, artistNames }: { scans: ScanRow[]; artistNames?: Map<string, string> }) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            {artistNames && <th>Artist</th>}
            <th>Check</th>
            <th>Result</th>
            <th>What was found</th>
            <th>When</th>
            <th>Decision</th>
          </tr>
        </thead>
        <tbody>
          {scans.map((scan) => {
            const description = describeScan(scan);
            return (
              <tr key={scan.id}>
                {artistNames && <td className="cell-main">{(scan.artist_id && artistNames.get(scan.artist_id)) || "—"}</td>}
                <td>
                  {description.title}
                  <br />
                  <span className="muted">{scan.provider}</span>
                </td>
                <td>
                  <StatusBadge status={scan.result} />
                </td>
                <td>
                  {description.text || "—"}
                  {scan.matched_track_id && (
                    <>
                      {" "}
                      <Link href={`/catalog/tracks/${scan.matched_track_id}`} className="text-link">
                        Open the matching track
                      </Link>
                    </>
                  )}
                </td>
                <td>{formatDateTime(scan.created_at)}</td>
                <td>
                  {scan.decision ? (
                    `${scan.decision === "confirmed" ? "Real problem" : "False alarm"}${scan.decision_note ? ` — ${scan.decision_note}` : ""}`
                  ) : scan.result === "ok" ? (
                    "—"
                  ) : (
                    <details className="history">
                      <summary>Decide</summary>
                      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)", marginTop: "var(--space-xs)" }}>
                        <ActionForm action={decideScan} submitLabel="False alarm" pendingLabel="Saving…" tone="secondary">
                          <input type="hidden" name="scanId" value={scan.id} />
                          <input type="hidden" name="decision" value="dismissed" />
                          <input name="note" maxLength={500} placeholder="Optional note" className="input-field input-field--sm" />
                        </ActionForm>
                        <ActionForm
                          action={decideScan}
                          submitLabel="Real problem"
                          pendingLabel="Saving…"
                          tone="danger"
                          confirm="Mark this check as a real problem? The decision cannot be changed afterwards."
                        >
                          <input type="hidden" name="scanId" value={scan.id} />
                          <input type="hidden" name="decision" value="confirmed" />
                          <input name="note" required minLength={3} maxLength={500} placeholder="What did you find?" className="input-field input-field--sm" />
                        </ActionForm>
                      </div>
                    </details>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
