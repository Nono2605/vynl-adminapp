// Barre horizontale proportionnelle (part d'un total). Décorative : le chiffre est
// toujours écrit à côté.
export function ShareBar({ value, max }: { value: number; max: number }) {
  const width = max > 0 ? Math.max((value / max) * 100, value > 0 ? 1 : 0) : 0;
  return (
    <span className="share" aria-hidden="true">
      <span className="share__fill" style={{ width: `${width}%` }} />
    </span>
  );
}
