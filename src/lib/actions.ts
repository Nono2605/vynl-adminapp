import "server-only";
import { revalidatePath } from "next/cache";
import type { AdminUser } from "@/lib/session";
import { isUuid } from "@/lib/query";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { ActionState } from "@/lib/actionTypes";

// Erreur « métier » : une règle qu'on a vérifiée et dont le message s'adresse à
// l'admin (« you cannot suspend your own account »). Tout le reste est un
// incident, journalisé comme tel.
export class ActionError extends Error {}

export type AuditTargetType = "user" | "track" | "album" | "ai_declaration" | "play" | "fraud_event";

export interface AuditTarget {
  type: AuditTargetType;
  id: string;
  label?: string;
}

interface Outcome {
  message: string;
  // Complète le détail du journal (valeurs après action). Jamais un secret.
  details?: Record<string, unknown>;
  secret?: string;
}

const MIGRATION_HINT =
  "Apply supabase/migrations/20261010100000_admin_actions.sql in the Supabase SQL editor, then try again.";

// Transforme une ActionError levée pendant les vérifications préalables en
// résultat affichable ; toute autre erreur remonte (error.tsx).
export async function actionResult(run: () => Promise<ActionState>): Promise<ActionState> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof ActionError) return { error: error.message };
    throw error;
  }
}

// Une erreur Supabase devient une ActionError : les messages des garde-fous de
// la base (« A track needs an audio file before it can be published ») sont
// écrits pour être lus.
export function ensure(error: { message: string } | null, context: string): void {
  if (error) throw new ActionError(`${context}: ${error.message}`);
}

// Exécute une mutation en la journalisant AVANT et APRÈS :
//  1. une ligne « pending » est écrite ; si elle ne peut pas l'être (table
//     absente, base en panne), l'action n'a PAS lieu ;
//  2. la mutation s'exécute ;
//  3. la ligne passe à « success » ou « failed » (verrouillée ensuite par un
//     trigger de la base).
// Les vérifications (droits, règles métier) se font avant d'appeler cette
// fonction, pour ne pas polluer le journal de demandes invalides.
export async function runAudited(
  admin: AdminUser,
  action: string,
  target: AuditTarget,
  details: Record<string, unknown>,
  mutate: () => Promise<Outcome>
): Promise<ActionState> {
  const db = supabaseAdmin();

  const { data: entry, error: insertError } = await db
    .from("admin_audit_log")
    .insert({
      admin_id: admin.id,
      admin_email: admin.email,
      action,
      target_type: target.type,
      target_id: target.id,
      target_label: target.label ?? null,
      details,
    })
    .select("id")
    .single();

  if (insertError || !entry) {
    console.error(`Audit log unavailable, action ${action} refused: ${insertError?.message ?? "no row returned"}`);
    return {
      error: `Nothing was changed: the audit log is not available (${insertError?.message ?? "no row returned"}). ${MIGRATION_HINT}`,
    };
  }

  const finish = async (fields: Record<string, unknown>) => {
    const { error } = await db
      .from("admin_audit_log")
      .update({ ...fields, finished_at: new Date().toISOString() })
      .eq("id", entry.id);
    if (error) console.error(`Could not finalize audit entry ${entry.id}: ${error.message}`);
    return !error;
  };

  try {
    const outcome = await mutate();
    const finalized = await finish({ outcome: "success", details: { ...details, ...outcome.details } });
    // Les pages sont dynamiques ; on invalide quand même le cache du routeur
    // pour que la page affichée se rafraîchisse après l'action.
    revalidatePath("/", "layout");
    return {
      ok: true,
      message: finalized ? outcome.message : `${outcome.message} (the audit entry could not be finalized, see the server logs)`,
      secret: outcome.secret,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    if (!(error instanceof ActionError)) console.error(`Admin action ${action} failed`, error);
    await finish({ outcome: "failed", error: message });
    return { error: message };
  }
}

// Accès à une donnée INDIVIDUELLE sensible (l'historique d'écoute d'un compte) : une
// ligne du journal est écrite AVANT d'afficher, et si elle ne peut pas l'être (table
// absente, base en panne) on n'affiche rien. Un même admin qui rouvre la même fiche
// dans les 10 minutes ne crée pas une ligne de plus. Contrairement à runAudited, il n'y
// a rien à modifier : la ligne naît directement « success ». Les agrégats (analytics)
// ne passent pas par ici, ils ne désignent personne.
const ACCESS_DEDUP_MS = 10 * 60 * 1000;

export async function recordAccess(
  admin: AdminUser,
  action: string,
  target: AuditTarget,
  details: Record<string, unknown> = {}
): Promise<void> {
  const db = supabaseAdmin();
  const unavailable = (message: string) =>
    new ActionError(`The audit log is not available (${message}), so this history is not shown. ${MIGRATION_HINT}`);

  const { data: recent, error: recentError } = await db
    .from("admin_audit_log")
    .select("id")
    .eq("admin_id", admin.id)
    .eq("action", action)
    .eq("target_id", target.id)
    .gte("created_at", new Date(Date.now() - ACCESS_DEDUP_MS).toISOString())
    .limit(1);
  if (recentError) throw unavailable(recentError.message);
  if (recent && recent.length > 0) return;

  const { error } = await db.from("admin_audit_log").insert({
    admin_id: admin.id,
    admin_email: admin.email,
    action,
    target_type: target.type,
    target_id: target.id,
    target_label: target.label ?? null,
    details,
    outcome: "success",
    finished_at: new Date().toISOString(),
  });
  if (error) throw unavailable(error.message);
}

// --- Lecture des formulaires : tout vient du client, rien n'est fiable. ---

export function formText(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

export function formUuid(formData: FormData, key: string): string {
  const value = formText(formData, key);
  if (!isUuid(value)) throw new ActionError("Invalid request: missing or malformed id.");
  return value;
}

// Motif saisi par l'admin. `required` : il le faut pour les décisions qui
// touchent quelqu'un (suspension, refus), et le journal le garde.
export function formReason(formData: FormData, key: string, required: boolean): string {
  const reason = formText(formData, key);
  if (required && reason.length < 3) throw new ActionError("A reason of at least 3 characters is required.");
  if (reason.length > 500) throw new ActionError("The reason is too long (500 characters maximum).");
  return reason;
}
