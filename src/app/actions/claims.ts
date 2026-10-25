"use server";

import { ActionError, actionResult, ensure, formReason, formUuid, runAudited } from "@/lib/actions";
import type { ActionState } from "@/lib/actionTypes";
import { canTransition, claimReference, isDecided, type ClaimStatus } from "@/lib/rightsClaims";
import { requireAdmin } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase/admin";

// Les signalements des ayants droit (spec 15.3, C4). Chaque décision est journalisée AVANT et APRÈS (runAudited) et
// relue en base à l'instant de la décision, pas d'après la page. La base impose les mêmes transitions
// (API/supabase/migrations/20261025000002_rights_claims.sql) : un signalement décidé ne change plus.

interface ClaimRow {
  id: string;
  claim_number: number;
  status: string;
  track_id: string | null;
}

async function loadClaim(claimId: string): Promise<ClaimRow> {
  const { data, error } = await supabaseAdmin().from("rights_claims").select("id, claim_number, status, track_id").eq("id", claimId).maybeSingle();
  ensure(error, "Could not read the claim");
  if (!data) throw new ActionError("Claim not found.");
  return data as ClaimRow;
}

function requireOpen(claim: ClaimRow, to: ClaimStatus): void {
  if (!canTransition(claim.status, to)) {
    throw new ActionError(
      isDecided(claim.status)
        ? `This claim is already ${claim.status} and can no longer change.`
        : `A claim "${claim.status}" cannot become "${to}". Reload the page.`
    );
  }
}

// Reçu -> en cours d'examen : sert à ne pas laisser croire qu'un signalement est ignoré.
export async function startClaimReview(_state: ActionState | undefined, formData: FormData): Promise<ActionState> {
  return actionResult(async () => {
    const admin = await requireAdmin();
    const claim = await loadClaim(formUuid(formData, "claimId"));
    requireOpen(claim, "in_review");

    return runAudited(
      admin,
      "claim.start_review",
      { type: "rights_claim", id: claim.id, label: claimReference(claim.claim_number) },
      { from: claim.status, to: "in_review" },
      async () => {
        const { data, error } = await supabaseAdmin().from("rights_claims").update({ status: "in_review" }).eq("id", claim.id).eq("status", claim.status).select("id");
        ensure(error, "The database refused the change");
        if (data?.length !== 1) throw new ActionError("The claim changed in the meantime. Reload the page.");
        return { message: `${claimReference(claim.claim_number)} is now in review.` };
      }
    );
  });
}

// Signalement fondé : le morceau est archivé, les empreintes de ses fichiers sont bloquées (plus de ré-envoi) et le
// signalement est clos, en UNE transaction (fonction SQL uphold_rights_claim). Rien n'est supprimé.
export async function upholdClaim(_state: ActionState | undefined, formData: FormData): Promise<ActionState> {
  return actionResult(async () => {
    const admin = await requireAdmin();
    const claim = await loadClaim(formUuid(formData, "claimId"));
    const trackId = formUuid(formData, "trackId");
    const note = formReason(formData, "note", true);
    requireOpen(claim, "upheld");

    const db = supabaseAdmin();
    const { data: track, error: trackError } = await db.from("tracks").select("id, title, status").eq("id", trackId).maybeSingle();
    ensure(trackError, "Could not read the track");
    if (!track) throw new ActionError("This track does not exist. Check the identifier.");

    return runAudited(
      admin,
      "claim.uphold",
      { type: "rights_claim", id: claim.id, label: claimReference(claim.claim_number) },
      { reason: note, track_id: track.id, track_title: track.title, track_status_before: track.status },
      async () => {
        const { data, error } = await db.rpc("uphold_rights_claim", {
          p_claim: claim.id,
          p_admin: admin.id,
          p_track: track.id,
          p_note: note,
        });
        ensure(error, "The database refused the decision");
        const result = (Array.isArray(data) ? data[0] : data) as { files_blocked: number; files_without_checksum: number } | undefined;
        const blocked = Number(result?.files_blocked ?? 0);
        const unhashed = Number(result?.files_without_checksum ?? 0);
        return {
          message:
            `"${track.title}" is archived and ${blocked} file fingerprint${blocked === 1 ? "" : "s"} blocked.` +
            (unhashed > 0
              ? ` ${unhashed} file${unhashed === 1 ? " has" : "s have"} no fingerprint yet and cannot be blocked: run the audio backfill (npm run backfill:audio, in the API repository).`
              : ""),
          details: { files_blocked: blocked, files_without_checksum: unhashed },
        };
      }
    );
  });
}

async function decideWithoutRemoval(formData: FormData, to: "rejected" | "withdrawn", noteRequired: boolean): Promise<ActionState> {
  const admin = await requireAdmin();
  const claim = await loadClaim(formUuid(formData, "claimId"));
  const note = formReason(formData, "note", noteRequired);
  requireOpen(claim, to);

  return runAudited(
    admin,
    to === "rejected" ? "claim.reject" : "claim.withdraw",
    { type: "rights_claim", id: claim.id, label: claimReference(claim.claim_number) },
    { reason: note || undefined, from: claim.status, to },
    async () => {
      const { data, error } = await supabaseAdmin()
        .from("rights_claims")
        .update({ status: to, decided_by: admin.id, decided_at: new Date().toISOString(), decision_note: note || null })
        .eq("id", claim.id)
        .eq("status", claim.status)
        .select("id");
      ensure(error, "The database refused the decision");
      if (data?.length !== 1) throw new ActionError("The claim changed in the meantime. Reload the page.");
      return { message: `${claimReference(claim.claim_number)} ${to === "rejected" ? "rejected" : "marked as withdrawn"}.` };
    }
  );
}

// Rejeté : le signalement n'est pas retenu (la raison reste dans le journal, elle n'est pas envoyée au demandeur).
export async function rejectClaim(_state: ActionState | undefined, formData: FormData): Promise<ActionState> {
  return actionResult(() => decideWithoutRemoval(formData, "rejected", true));
}

// Retiré : le demandeur a renoncé.
export async function withdrawClaim(_state: ActionState | undefined, formData: FormData): Promise<ActionState> {
  return actionResult(() => decideWithoutRemoval(formData, "withdrawn", false));
}

// Lever les blocages d'un signalement fondé (une erreur, un accord avec l'ayant droit). Le morceau reste archivé : le
// rétablir se fait depuis sa fiche du catalogue. Les fichiers redeviennent simplement acceptés à l'envoi.
export async function liftClaimBlocks(_state: ActionState | undefined, formData: FormData): Promise<ActionState> {
  return actionResult(async () => {
    const admin = await requireAdmin();
    const claim = await loadClaim(formUuid(formData, "claimId"));
    const reason = formReason(formData, "reason", true);
    if (claim.status !== "upheld") throw new ActionError("Only an upheld claim has blocked files.");

    const db = supabaseAdmin();
    const { count, error: countError } = await db.from("blocked_files").select("id", { count: "exact", head: true }).eq("claim_id", claim.id);
    ensure(countError, "Could not read the blocked files");
    if (!count) throw new ActionError("This claim has no blocked file left.");

    return runAudited(
      admin,
      "claim.lift_blocks",
      { type: "rights_claim", id: claim.id, label: claimReference(claim.claim_number) },
      { reason, blocks: count },
      async () => {
        const { error } = await db.from("blocked_files").delete().eq("claim_id", claim.id);
        ensure(error, "The database refused the change");
        return { message: `${count} blocked file fingerprint${count === 1 ? "" : "s"} lifted. The track stays archived; restore it from the catalog if needed.` };
      }
    );
  });
}
