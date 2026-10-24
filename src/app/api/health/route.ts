import { NextResponse } from "next/server";
import { collectionChecks, schemaChecks } from "@/lib/healthChecks";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

// Contrôle de déploiement, public mais sans rien de sensible : uniquement des
// booléens (variable présente ou non, base joignable ou non, objet de migration
// présent ou non), jamais une valeur ni un message d'erreur. Sert à diagnostiquer un déploiement à
// distance : en production Next masque le message des erreurs de rendu. Le
// détail d'une erreur de base va dans les logs serveur.
export async function GET() {
  const env = {
    NEXT_PUBLIC_SUPABASE_URL: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: Boolean(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY),
    SUPABASE_SECRET_KEY: Boolean(process.env.SUPABASE_SECRET_KEY),
    // Adresse de l'API Vynl (page Revenue : état de la connexion Stripe).
    API_BASE_URL: Boolean(process.env.API_BASE_URL),
  };

  let database: "ok" | "error" | "skipped" = "skipped";
  let schema: Record<string, boolean> | undefined;
  let collection: Record<string, boolean> | undefined;

  if (env.NEXT_PUBLIC_SUPABASE_URL && env.SUPABASE_SECRET_KEY) {
    try {
      const { error } = await supabaseAdmin().from("users").select("id", { count: "exact", head: true });
      if (error) console.error(`Health check: database read failed: ${error.message}`);
      database = error ? "error" : "ok";
      if (!error) [schema, collection] = await Promise.all([schemaChecks(), collectionChecks()]);
    } catch (err) {
      console.error("Health check: database read threw", err);
      database = "error";
    }
  }

  return NextResponse.json({ env, database, schema, collection }, { headers: { "Cache-Control": "no-store" } });
}
