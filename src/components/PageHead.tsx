// Titre de page. `plain` pour un titre qui contient du texte saisi par un
// utilisateur (email, nom d'artiste) : la DA interdit Dela Gothic One sur ce
// genre de texte, la police est très large.
export function PageHead({
  title,
  plain = false,
  children,
}: {
  title: string;
  plain?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className="page-head">
      {plain ? <h1 className="page-title">{title}</h1> : <h1 className="display-title">{title}</h1>}
      {children}
    </div>
  );
}
