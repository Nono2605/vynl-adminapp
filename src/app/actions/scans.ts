"use server";

import { ActionError, actionResult, ensure, formReason, formText, formUuid, runAudited } from "@/lib/actions";
import type { ActionState } from "@/lib/actionTypes";
import { describeScan, isMissingTable } from "@/lib/scans";
import { requireAdmin } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase/admin";

// Décision d'un administrateur sur un contrôle de contenu (journal track_scans, spec 15.5) :
//  - « confirmed »  : c'est un vrai problème (copie, imitation) ; une raison est exigée ;
//  - « dismissed »  : fausse alerte.
// Une décision se prend UNE fois : la base la verrouille ensuite (trigger track_scans_guard). Elle ne
// modifie ni le morceau ni l'artiste : ce qu'on fait ensuite (écrire à l'artiste, refuser le morceau,
// suspendre) se décide avec les autres actions de l'admin ; la décision en garde la trace et la raison.
export async function decideScan(_state: ActionState | undefined, formData: FormData): Promise<ActionState> {
  return actionResult(async () => {
    const admin = await requireAdmin();
    const scanId = formUuid(formData, "scanId");
    const verdict = formText(formData, "decision");
    if (verdict !== "confirmed" && verdict !== "dismissed") throw new ActionError("Invalid decision.");
    const note = formReason(formData, "note", verdict === "confirmed");

    const db = supabaseAdmin();
    const { data: scan, error } = await db
      .from("track_scans")
      .select("id, track_id, artist_id, check_kind, result, score, detail, decision")
      .eq("id", scanId)
      .maybeSingle();
    if (isMissingTable(error)) {
      throw new ActionError("The check log is not set up yet: apply the latest migration of the API repository.");
    }
    ensure(error, "Could not read the check");
    if (!scan) throw new ActionError("Check not found.");
    if (scan.decision) throw new ActionError("A decision was already taken on this check. Reload the page.");

    const label = describeScan({ check_kind: scan.check_kind, score: scan.score, detail: scan.detail }).title;

    return runAudited(
      admin,
      verdict === "confirmed" ? "scan.confirm" : "scan.dismiss",
      { type: "scan", id: scan.id, label },
      {
        note: note || undefined,
        check_kind: scan.check_kind,
        result: scan.result,
        track_id: scan.track_id,
        artist_id: scan.artist_id,
      },
      async () => {
        const { data, error: updateError } = await db
          .from("track_scans")
          .update({
            decision: verdict,
            decided_by: admin.id,
            decided_at: new Date().toISOString(),
            decision_note: note || null,
          })
          .eq("id", scan.id)
          .is("decision", null) // garde de concurrence : on ne tranche que ce qui ne l'est pas encore
          .select("id");
        ensure(updateError, "The database refused the decision");
        if (data?.length !== 1) throw new ActionError("The check changed in the meantime. Reload the page.");
        return { message: verdict === "confirmed" ? "Marked as a real problem." : "Dismissed as a false alarm." };
      }
    );
  });
}
