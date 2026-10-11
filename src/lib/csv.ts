// CSV pour les exports de l'admin. Pur (testé). Deux précautions :
//  * les champs avec virgule, guillemet ou retour à la ligne sont entre guillemets ;
//  * un texte qui commence par = + - @ (ou tabulation / retour chariot) serait
//    interprété comme une FORMULE par Excel ou Sheets : un nom d'artiste saisi par un
//    utilisateur pourrait y exécuter du code à l'ouverture. On le fait précéder d'une
//    apostrophe, ce qui le rend inerte. Les nombres, eux, restent des nombres.
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";

  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  return [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
