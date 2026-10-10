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
