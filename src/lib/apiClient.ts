import "server-only";
import { createClient } from "@/lib/supabase/server";

// Appels de l'admin vers l'API Vynl (Render), côté serveur uniquement. L'admin n'a AUCUNE clé
// Stripe : c'est l'API qui parle à Stripe, et l'admin lui demande avec le jeton de la session
// de l'admin connecté (l'API vérifie le jeton ET le rôle admin).

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; status?: number; notConfigured?: boolean };

// Adresse de l'API (variable API_BASE_URL du déploiement Vercel de l'admin, sans « / » final).
export function apiBaseUrl(): string | null {
  const value = process.env.API_BASE_URL?.trim().replace(/\/+$/, "");
  return value && /^https?:\/\//.test(value) ? value : null;
}

export async function apiGet<T>(path: string): Promise<ApiResult<T>> {
  const base = apiBaseUrl();
  if (!base) return { ok: false, error: "API_BASE_URL is not set on this deployment.", notConfigured: true };

  const supabase = await createClient();
  // Le jeton est seulement transmis : c'est l'API qui le vérifie. (L'identité de l'admin a déjà
  // été validée par requireAdmin() avant d'arriver ici.)
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return { ok: false, error: "No session." };

  try {
    const response = await fetch(base + path, {
      headers: { Authorization: `Bearer ${session.access_token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      return { ok: false, status: response.status, error: body?.error ?? `The API answered ${response.status}.` };
    }
    return { ok: true, data: (await response.json()) as T };
  } catch {
    return { ok: false, error: "The API did not answer (network error or timeout)." };
  }
}
