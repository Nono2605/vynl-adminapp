import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { requireEnv } from "@/lib/env";

// Client Supabase « session » pour Server Actions / Server Components : lit et
// écrit la session de l'admin via les cookies Next.js. Clé publishable
// uniquement ; il ne sert qu'à savoir QUI est connecté. Toutes les lectures de
// données passent par supabaseAdmin() (clé secret, voir admin.ts).
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL),
    requireEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY),
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Appelé depuis un Server Component (pas une Server Action) :
            // pas grave, le middleware rafraîchit la session si besoin.
          }
        },
      },
    }
  );
}
