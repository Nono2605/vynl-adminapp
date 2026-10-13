import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

// Une migration est « appliquée » si les objets qu'elle crée répondent. On ne
// peut pas voir depuis PostgREST les triggers ni les clés étrangères : ce
// contrôle prouve la présence des tables, colonnes et fonctions, pas le reste.
async function schemaChecks(): Promise<Record<string, boolean>> {
  const db = supabaseAdmin();
  const selectable = async (table: string, columns: string) => !(await db.from(table).select(columns).limit(0)).error;

  const [adminAuditLog, trackReasons, albumReasons, declarationNotes, plays, heartbeats, integrity, preferences, onboarding, stats, numbers, simplified, analytics, privacyConsents, privacyRetention, billing, scanLog, nameSimilarity, genresTable, genreColumn, genreStats, fraudKey, fraudPlays] =
    await Promise.all([
      selectable("admin_audit_log", "id, outcome"),
      selectable("tracks", "rejection_reason"),
      selectable("albums", "rejection_reason"),
      selectable("ai_declarations", "review_note"),
      selectable("plays", "entitlement, last_heartbeat_at, country_code"),
      selectable("play_heartbeats", "play_id, seq"),
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
      // Le type énuméré n'accepte « declared » qu'après la simplification des déclarations IA.
      db
        .from("ai_declarations")
        .select("id")
        .eq("status", "declared")
        .limit(0)
        .then((result) => !result.error),
      // Fonctions d'analytics de l'admin (une fenêtre vide suffit : on teste l'existence).
      db
        .rpc("admin_stats_data_quality", { p_from: "2000-01-01T00:00:00Z", p_to: "2000-01-02T00:00:00Z" })
        .then((result) => !result.error),
      // Consentements (API/supabase/migrations/20261013000000_privacy_consents_and_retention.sql).
      selectable("consents", "id, purpose, granted, policy_version"),
      // L'aperçu de la purge ne modifie rien : on l'appelle pour tester que la fonction existe.
      db.rpc("privacy_retention_preview").then((result) => !result.error),
      // Facturation (API/supabase/migrations/20261013200000_billing_plans_payments.sql).
      Promise.all([
        selectable("plans", "code, price_cents, stripe_price_id"),
        selectable("payments", "id, gross_cents, tax_cents, fee_cents"),
        selectable("stripe_events", "id, outcome"),
        selectable("billing_customers", "user_id"),
      ]).then((r) => r.every(Boolean)),
      // Journal des contrôles et ressemblance de noms (API/supabase/migrations/20261014000001_scan_log_and_name_similarity.sql).
      selectable("track_scans", "id, check_kind, result, decision"),
      // En lecture seule : un nom sans équivalent renvoie zéro ligne si la fonction existe.
      db.rpc("similar_artist_names", { p_name: "zzzzzzzzzz", p_exclude_artist: null }).then((result) => !result.error),
      // Genres (API/supabase/migrations/20261014000002_genres.sql) puis statistiques par genre
      // (supabase/migrations/20261014100000_admin_genres.sql, de ce dépôt).
      selectable("genres", "code, label, active"),
      selectable("tracks", "genre_code"),
      db
        .rpc("admin_stats_genres", { p_from: "2000-01-01T00:00:00Z", p_to: "2000-01-02T00:00:00Z" })
        .then((result) => !result.error),
      // Détection de fraude (API/supabase/migrations/20261014000005_fraud_detection.sql). On ne lance PAS
      // fraud_detect (elle écrit) : on lit la colonne de clé et on appelle la fonction de portée en lecture seule.
      selectable("fraud_events", "dedupe_key"),
      db.rpc("fraud_event_plays", { p_event_id: "00000000-0000-0000-0000-000000000000" }).then((result) => !result.error),
    ]);

  return {
    // Migration de l'admin (supabase/migrations/20261010100000_admin_actions.sql)
    admin_actions: adminAuditLog && trackReasons && albumReasons && declarationNotes,
    // Migration de l'admin (supabase/migrations/20261011100000_ai_declaration_simplify.sql)
    ai_declaration_simplified: simplified,
    // Migration de l'admin (supabase/migrations/20261011200000_admin_analytics.sql)
    admin_analytics: analytics,
    // Migrations de l'API (API/supabase/migrations)
    privacy_consents_and_retention: privacyConsents && privacyRetention,
    billing_plans_payments: billing,
    scan_log_and_name_similarity: scanLog && nameSimilarity,
    genres: genresTable && genreColumn,
    admin_genres: genreStats,
    fraud_detection: fraudKey && fraudPlays,
    integrity_guards: integrity,
    listening_entitlement_and_plays: plays && heartbeats,
    creator_onboarding: onboarding,
    listener_preferences: preferences,
    creator_stats: stats,
    catalog_numbers_and_artist_names: numbers,
  };
}

// Est-ce que la collecte remplit vraiment pays, appareil et empreinte d'IP en production ?
// Un booléen par colonne (au moins une écoute en porte une) : aucune valeur, aucun compte.
async function collectionChecks(): Promise<Record<string, boolean>> {
  const db = supabaseAdmin();
  const seen = async (column: string) => {
    const { data, error } = await db.from("plays").select("id").not(column, "is", null).limit(1);
    return !error && (data?.length ?? 0) > 0;
  };
  const [country, device, ipHash, source] = await Promise.all([
    seen("country_code"),
    seen("device_type"),
    seen("ip_hash"),
    seen("source_context"),
  ]);
  return { plays_with_country: country, plays_with_device: device, plays_with_ip_hash: ipHash, plays_with_source: source };
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
