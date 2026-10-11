// Mise en forme des valeurs affichées. Tout est en UTC, serveur comme
// navigateur : pas de décalage selon le fuseau de celui qui regarde.
const dateFormat = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: "UTC" });
const dateTimeFormat = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});

export function formatNumber(value: number): string {
  return value.toLocaleString("en-US");
}

export function formatDate(value: string | null | undefined): string {
  return value ? dateFormat.format(new Date(value)) : "—";
}

export function formatDateTime(value: string | null | undefined): string {
  return value ? `${dateTimeFormat.format(new Date(value))} UTC` : "—";
}

// 215 -> "3:35"
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return "—";
  const total = Math.round(seconds);
  const minutes = Math.floor(total / 60);
  const rest = String(total % 60).padStart(2, "0");
  return `${minutes}:${rest}`;
}

const dayFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

// "10 Oct"
export function formatDay(value: Date): string {
  return dayFormat.format(value);
}

// Temps d'écoute lisible : 45 s, 12 min, 3.5 h.
export function formatListening(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0 min";
  if (seconds < 60) return `${Math.round(seconds)} s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  return `${(seconds / 3600).toLocaleString("en-US", { maximumFractionDigits: 1 })} h`;
}

// Part en pourcentage (« 12.5% »), « — » quand le total est nul.
export function formatShare(part: number, whole: number): string {
  if (!whole) return "—";
  return `${((part / whole) * 100).toLocaleString("en-US", { maximumFractionDigits: 1 })}%`;
}

// 1000, "chf" -> « CHF 10.00 ». Montant en centimes, devise ISO 4217 en minuscules (comme la base).
export function formatMoney(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-CH", { style: "currency", currency: currency.toUpperCase() }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
}
