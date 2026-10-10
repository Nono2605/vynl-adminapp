// Page pas encore construite : elle dit ce qu'elle contiendra, jamais un chiffre
// inventé (règle de la DA : données réelles uniquement, sinon « Coming »).
export function ComingSoon({
  title,
  intro,
  items,
}: {
  title: string;
  intro: string;
  items: string[];
}) {
  return (
    <>
      <div className="page-head">
        <h1 className="display-title">{title}</h1>
      </div>
      <section className="dash-card coming-soon">
        <span className="status status--soon">Coming</span>
        <p>{intro}</p>
        <ul className="coming-soon__list">
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>
    </>
  );
}
