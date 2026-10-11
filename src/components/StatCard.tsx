import { formatNumber } from "@/lib/format";

// Carte de chiffre. `null` = valeur indisponible (la requête a échoué) : on
// affiche « — », jamais un 0 trompeur. `warn` colore en alerte quand il y a
// quelque chose à traiter.
export function StatCard({
  label,
  value,
  warn = false,
  hint,
  display,
}: {
  label: string;
  value: number | null;
  warn?: boolean;
  hint?: string;
  // Texte à afficher à la place du nombre (ex. « 3.5 h » pour un temps d'écoute).
  display?: string;
}) {
  return (
    <section className="dash-card stat-card">
      <span className="stat-label">{label}</span>
      <span className="stat-value" style={warn && value ? { color: "var(--vynl-alerte)" } : undefined}>
        {value === null ? "—" : (display ?? formatNumber(value))}
      </span>
      {hint && <span className="stat-hint">{hint}</span>}
    </section>
  );
}
