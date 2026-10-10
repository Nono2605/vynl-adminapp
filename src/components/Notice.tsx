// Avertissement dans la page (échec de chargement d'une section, plafond
// atteint…). Une section qui échoue n'empêche pas les autres de s'afficher.
export function Notice({ children }: { children: React.ReactNode }) {
  return (
    <p className="notice" role="alert">
      {children}
    </p>
  );
}
