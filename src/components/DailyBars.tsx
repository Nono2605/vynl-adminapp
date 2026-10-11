import { formatNumber } from "@/lib/format";
import type { DailyRow } from "@/lib/analytics";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function dayLabel(day: string): string {
  const [, month, date] = day.split("-");
  return `${Number(date)} ${MONTHS[Number(month) - 1]}`;
}

// Histogramme par jour (UTC) : la hauteur est le nombre de lectures comptées, la partie
// cyan celles qui ont été qualifiées (30 s). Au-delà de 31 jours on n'écrit plus les
// valeurs sur les barres (illisible) ni toutes les dates : le survol les donne.
export function DailyBars({ rows }: { rows: DailyRow[] }) {
  const max = Math.max(...rows.map((row) => row.starts), 1);
  const dense = rows.length > 31;
  const labelEvery = Math.max(Math.ceil(rows.length / 8), 1);

  return (
    <div
      className="bars"
      role="img"
      aria-label={`Plays per day over ${rows.length} days`}
      style={dense ? { gap: 2 } : undefined}
    >
      {rows.map((row, index) => (
        <div
          key={row.day}
          className="bars__col"
          title={`${row.day}: ${formatNumber(row.starts)} started, ${formatNumber(row.plays)} qualified, ${formatNumber(row.listeners)} listeners`}
        >
          {!dense && <span className="bars__value">{formatNumber(row.plays)}</span>}
          <div className="bars__bar" style={{ height: `${Math.max((row.starts / max) * 100, 1)}%` }}>
            <div className="bars__bar-fill" style={{ height: row.starts ? `${(row.plays / row.starts) * 100}%` : 0 }} />
          </div>
          <span className="bars__label">{index % labelEvery === 0 ? dayLabel(row.day) : " "}</span>
        </div>
      ))}
    </div>
  );
}
