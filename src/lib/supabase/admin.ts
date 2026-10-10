import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { requireEnv } from "@/lib/env";

// Client Supabase à clé SECRET : contourne la RLS (aucune policy n'existe sur
// les tables, seule cette clé peut les lire). `server-only` fait échouer le
// build si un Client Component l'importe un jour par erreur, ce qui ferait
// fuiter la clé dans le navigateur.
let client: SupabaseClient | undefined;

export function supabaseAdmin(): SupabaseClient {
  client ??= createClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL),
    requireEnv("SUPABASE_SECRET_KEY", process.env.SUPABASE_SECRET_KEY),
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
  return client;
}
