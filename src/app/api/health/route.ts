import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

// Une migration est « appliquée » si les objets qu'elle crée répondent. On ne
// peut pas voir depuis PostgREST les triggers ni les clés étrangères : ce
// contrôle prouve la présence des tables, colonnes et fonctions, pas le reste.
async function schemaChecks(): Promise<Record<string, boolean>> {
  const db = supabaseAdmin();
  const selectable = async (table: string, columns: string) => !(await db.from(table).select(columns).limit(0)).error;

  const [adminAuditLog, trackReasons, albumReasons, declarationNotes, plays, heartbeats, integrity, preferences, onboarding, stats, numbers] =
    await Promise.all([
      selectable("admin_audit_log", "id, outcome"),
      selectable("tracks", "rejection_reason"),
      selectable("albums", "rejection_reason"),
      selectable("ai_declarations", "review_note"),
      selectable("plays", "entitlement, last_heartbeat_at, country_code"),
      selectable("play_heartbeats", "id"),
      // tracks.published_by + track_files.verified_at : posés par integrity_guards.
      Promise.all([selectable("tracks", "published_by"), selectable("track_files", "verified_at")]).then((r) => r.every(Boolean)),
      selectable("profiles", "explicit_content, favorite_genres"),
      selectable("creator_onboarding", "user_id"),
      // Fonction en lecture seule : un artiste inexistant renvoie des zéros si elle existe.
      db
        .rpc("creator_stats_totals", {
          p_artist_id: "00000000-0000-0000-0000-000000000000",
          p_from: "2000-01-01T00:00:00Z",
          p_to: "2000-01-02T00:00:00Z",
        })
        .then((result) => !result.error),
      // Numéros de catalogue + anonymisation (colonnes posées par 20261011000000) ; les
      // triggers, eux, ne se voient pas d'ici.
      Promise.all([
        selectable("artists", "catalog_code, name_key, anonymized_at"),
        selectable("albums", "catalog_code, archived_reason"),
        selectable("tracks", "catalog_code, archived_reason"),
        selectable("track_files", "purged_at"),
      ]).then((r) => r.every(Boolean)),
    ]);

  return {
    // Migration de l'admin (supabase/migrations/20261010100000_admin_actions.sql)
    admin_actions: adminAuditLog && trackReasons && albumReasons && declarationNotes,
    // Migrations de l'API (API/supabase/migrations)
    integrity_guards: integrity,
    listening_entitlement_and_plays: plays && heartbeats,
    creator_onboarding: onboarding,
    listener_preferences: preferences,
    creator_stats: stats,
    catalog_numbers_and_artist_names: numbers,
  };
}

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
  };

  let database: "ok" | "error" | "skipped" = "skipped";
  let schema: Record<string, boolean> | undefined;

  if (env.NEXT_PUBLIC_SUPABASE_URL && env.SUPABASE_SECRET_KEY) {
    try {
      const { error } = await supabaseAdmin().from("users").select("id", { count: "exact", head: true });
      if (error) console.error(`Health check: database read failed: ${error.message}`);
      database = error ? "error" : "ok";
      if (!error) schema = await schemaChecks();
    } catch (err) {
      console.error("Health check: database read threw", err);
      database = "error";
    }
  }

  return NextResponse.json({ env, database, schema }, { headers: { "Cache-Control": "no-store" } });
}
