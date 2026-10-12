import Link from "next/link";
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
                  {scan.decision ? `${scan.decision}${scan.decision_note ? ` — ${scan.decision_note}` : ""}` : "Not reviewed"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
