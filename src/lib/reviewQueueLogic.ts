// Logique pure de la file de relecture (pas de base, pas de serveur) : testable
// seule. La file est la liste des identifiants « en relecture », du plus ancien
// au plus récent.

// L'élément à ouvrir ensuite :
//  * sans élément courant : le plus ancien ;
//  * élément courant encore dans la file (on le « saute ») : celui d'après, ou, si
//    c'était le dernier, le plus ancien des AUTRES (on boucle) ;
//  * élément courant absent de la file (il vient d'être décidé) : le plus ancien.
// Renvoie null quand il n'y a rien d'autre à ouvrir.
export function nextAfter(ids: readonly string[], currentId?: string): string | null {
  if (ids.length === 0) return null;
  if (!currentId) return ids[0];

  const index = ids.indexOf(currentId);
  if (index === -1) return ids[0];

  return ids[index + 1] ?? ids.find((id) => id !== currentId) ?? null;
}

// Rang (à partir de 1) de l'élément dans la file, ou null s'il n'y est pas.
export function positionOf(ids: readonly string[], currentId: string): number | null {
  const index = ids.indexOf(currentId);
  return index === -1 ? null : index + 1;
}
