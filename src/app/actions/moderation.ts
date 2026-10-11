"use server";

import {
  ActionError,
  actionResult,
  ensure,
  formReason,
  formText,
  formUuid,
  runAudited,
} from "@/lib/actions";
import type { ActionState } from "@/lib/actionTypes";
import { advanceAfterDecision } from "@/lib/reviewQueue";
import { requireAdmin } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { loadTrackChecks } from "@/lib/trackReview";

// Les créateurs choisissent eux-mêmes draft / in_review / archived ; « published »
// est réservé à l'admin (voir l'API). Accepter une publication = in_review ->
// published ; la refuser = retour en brouillon avec un motif que le créateur
// peut lire ; retirer = published -> archived ; rétablir = archived -> published.
// Les mêmes transitions valent pour les albums.
const DECISIONS = {
  approve: { from: "in_review", to: "published", needsReason: false },
  refuse: { from: "in_review", to: "draft", needsReason: true },
  archive: { from: "published", to: "archived", needsReason: true },
  restore: { from: "archived", to: "published", needsReason: false },
} as const;

type Decision = keyof typeof DECISIONS;

function parseDecision(formData: FormData): Decision {
  const value = formText(formData, "decision");
  if (!(value in DECISIONS)) throw new ActionError("Invalid decision.");
  return value as Decision;
}

// En mode file d'attente (formulaire envoyé depuis ?flow=1), accepter ou refuser
// ouvre directement l'élément suivant. Archiver / rétablir ne font pas partie de
// la file : on reste sur la fiche.
function inQueueFlow(formData: FormData, decision: Decision): boolean {
  return formText(formData, "flow") === "1" && (decision === "approve" || decision === "refuse");
}

const DONE: Record<Decision, string> = {
  approve: "published",
  refuse: "sent back to draft",
  archive: "archived",
  restore: "restored",
};

export async function reviewTrack(_state: ActionState | undefined, formData: FormData): Promise<ActionState> {
  return actionResult(async () => {
    const admin = await requireAdmin();
    const trackId = formUuid(formData, "trackId");
    const decision = parseDecision(formData);
    const rule = DECISIONS[decision];
    const reason = formReason(formData, "reason", rule.needsReason);

    // État relu en base à l'instant de la décision, pas celui de la page.
    const { track, blocking } = await loadTrackChecks(trackId);
    if (track.status !== rule.from) {
      throw new ActionError(`This track is "${track.status}", not "${rule.from}". Reload the page.`);
    }
    if (rule.to === "published" && blocking.length > 0) {
      throw new ActionError(`It cannot be published yet: ${blocking.map((check) => `${check.label.toLowerCase()} (${check.detail.toLowerCase()})`).join("; ")}.`);
    }

    const updates: Record<string, unknown> = {
      status: rule.to,
      // Le motif reste lisible par le créateur ; effacé dès que la décision est positive.
      rejection_reason: rule.needsReason ? reason : null,
    };
    if (decision === "approve") updates.published_by = admin.id;

    const result = await runAudited(
      admin,
      `track.${decision}`,
      { type: "track", id: track.id, label: track.title },
      { reason: reason || undefined, from: rule.from, to: rule.to },
      async () => {
        const { data, error } = await supabaseAdmin()
          .from("tracks")
          .update(updates)
          .eq("id", track.id)
          .eq("status", rule.from)
          .select("id");
        ensure(error, "The database refused the change");
        if (data?.length !== 1) throw new ActionError("The track changed in the meantime. Reload the page.");
        return { message: `"${track.title}" ${DONE[decision]}.` };
      }
    );

    // Seulement si la décision a bien été prise : une erreur reste affichée sur la fiche.
    if (result.ok && inQueueFlow(formData, decision)) {
      await advanceAfterDecision("tracks", track.id, decision, track.title);
    }
    return result;
  });
}

export async function reviewAlbum(_state: ActionState | undefined, formData: FormData): Promise<ActionState> {
  return actionResult(async () => {
    const admin = await requireAdmin();
    const albumId = formUuid(formData, "albumId");
    const decision = parseDecision(formData);
    const rule = DECISIONS[decision];
    const reason = formReason(formData, "reason", rule.needsReason);

    const db = supabaseAdmin();
    const [album, tracks] = await Promise.all([
      db.from("albums").select("id, title, status").eq("id", albumId).maybeSingle(),
      db.from("tracks").select("id", { count: "exact", head: true }).eq("album_id", albumId),
    ]);
    ensure(album.error, "Could not read the album");
    ensure(tracks.error, "Could not read the album's tracks");
    const row = album.data;
    if (!row) throw new ActionError("Album not found.");
    if (row.status !== rule.from) {
      throw new ActionError(`This album is "${row.status}", not "${rule.from}". Reload the page.`);
    }
    if (rule.to === "published" && (tracks.count ?? 0) === 0) {
      throw new ActionError("An album with no tracks cannot be published.");
    }

    const result = await runAudited(
      admin,
      `album.${decision}`,
      { type: "album", id: row.id, label: row.title },
      { reason: reason || undefined, from: rule.from, to: rule.to },
      async () => {
        const { data, error } = await db
          .from("albums")
          .update({ status: rule.to, rejection_reason: rule.needsReason ? reason : null })
          .eq("id", row.id)
          .eq("status", rule.from)
          .select("id");
        ensure(error, "The database refused the change");
        if (data?.length !== 1) throw new ActionError("The album changed in the meantime. Reload the page.");
        return { message: `"${row.title}" ${DONE[decision]}.` };
      }
    );

    if (result.ok && inQueueFlow(formData, decision)) {
      await advanceAfterDecision("albums", row.id, decision, row.title);
    }
    return result;
  });
}

// Une déclaration IA n'est plus relue : le créateur déclare, c'est tout. L'admin ne
// s'en sert que dans un cas exceptionnel : REFUSER la déclaration (le morceau ne peut
// plus être publié tant qu'elle tient, motif obligatoire que le créateur lit), ou
// RETIRER ce refus. Seule la dernière déclaration d'un morceau compte, donc seule
// elle peut être refusée ou rétablie. Qui, quand et pourquoi : dans le journal d'audit.
export async function reviewDeclaration(_state: ActionState | undefined, formData: FormData): Promise<ActionState> {
  return actionResult(async () => {
    const admin = await requireAdmin();
    const declarationId = formUuid(formData, "declarationId");
    const verdict = formText(formData, "decision");
    if (verdict !== "reject" && verdict !== "reinstate") throw new ActionError("Invalid decision.");
    const note = formReason(formData, "note", verdict === "reject");
    const reject = verdict === "reject";

    const db = supabaseAdmin();
    const { data: declaration, error } = await db
      .from("ai_declarations")
      .select("id, track_id, status, tracks(title)")
      .eq("id", declarationId)
      .maybeSingle();
    ensure(error, "Could not read the declaration");
    if (!declaration) throw new ActionError("Declaration not found.");

    // Seule la dernière déclaration du morceau fait foi (voir loadTrackChecks).
    const { data: latest, error: latestError } = await db
      .from("ai_declarations")
      .select("id")
      .eq("track_id", declaration.track_id)
      .order("declared_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    ensure(latestError, "Could not read the track's declarations");
    if (latest?.id !== declaration.id) {
      throw new ActionError("Only the latest declaration of a track can be rejected or reinstated.");
    }

    const isRejected = declaration.status === "rejected";
    if (reject && isRejected) throw new ActionError("This declaration is already rejected. Reload the page.");
    if (!reject && !isRejected) throw new ActionError("This declaration is not rejected. Reload the page.");

    const trackRelation = declaration.tracks as { title: string } | { title: string }[] | null;
    const title = (Array.isArray(trackRelation) ? trackRelation[0] : trackRelation)?.title;

    return runAudited(
      admin,
      reject ? "ai_declaration.reject" : "ai_declaration.reinstate",
      { type: "ai_declaration", id: declaration.id, label: title },
      {
        note: note || undefined,
        track_id: declaration.track_id,
        from: isRejected ? "rejected" : "declared",
        to: reject ? "rejected" : "declared",
      },
      async () => {
        const update = db
          .from("ai_declarations")
          .update(reject ? { status: "rejected", review_note: note } : { status: "declared", review_note: null })
          .eq("id", declaration.id);
        // Garde de concurrence : on ne change que depuis l'état lu plus haut.
        const { data, error: updateError } = await (reject ? update.neq("status", "rejected") : update.eq("status", "rejected")).select("id");

        if (updateError?.message.includes("enum")) {
          throw new ActionError(
            "The database still uses the old declaration statuses: apply supabase/migrations/20261011100000_ai_declaration_simplify.sql first."
          );
        }
        ensure(updateError, "The database refused the change");
        if (data?.length !== 1) throw new ActionError("The declaration changed in the meantime. Reload the page.");
        return { message: reject ? "Declaration rejected: the track cannot be published as declared." : "Rejection withdrawn." };
      }
    );
  });
}
