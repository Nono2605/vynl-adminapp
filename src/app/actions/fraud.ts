"use server";

import { ActionError, actionResult, ensure, formReason, formText, formUuid, runAudited } from "@/lib/actions";
import type { ActionState } from "@/lib/actionTypes";
import { findFrozenPeriod } from "@/lib/periods";
import { requireAdmin } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase/admin";

// Préfixe des motifs posés par un admin : on les distingue ainsi des motifs
// futurs posés automatiquement par la détection (colonne plays.excluded_reason).
const ADMIN_REASON_PREFIX = "admin: ";

// Une écoute suspecte est EXCLUE (counted = false, avec un motif), jamais
// supprimée : elle reste dans l'historique mais ne pèse plus dans le partage de
// l'argent des abonnés. La remettre en compte est possible tant que sa période
// de royalties n'est pas close.
export async function setPlayCounted(_state: ActionState | undefined, formData: FormData): Promise<ActionState> {
  return actionResult(async () => {
    const admin = await requireAdmin();
    const playId = formUuid(formData, "playId");
    const decision = formText(formData, "decision");
    if (decision !== "exclude" && decision !== "include") throw new ActionError("Invalid decision.");
    const reason = formReason(formData, "reason", decision === "exclude");

    const db = supabaseAdmin();
    const { data: play, error } = await db
      .from("plays")
      .select("id, started_at, counted, excluded_reason, tracks(title)")
      .eq("id", playId)
      .maybeSingle();
    ensure(error, "Could not read the play");
    if (!play) throw new ActionError("Play not found.");

    const wantCounted = decision === "include";
    if (play.counted === wantCounted) {
      throw new ActionError(wantCounted ? "This play is already counted." : "This play is already excluded.");
    }

    const frozen = await findFrozenPeriod(play.started_at);
    if (frozen) {
      throw new ActionError(
        `This play belongs to the ${frozen.status} period ${frozen.period_start} to ${frozen.period_end}, which can no longer change. A correction goes into a later period.`
      );
    }

    const relation = play.tracks as { title: string } | { title: string }[] | null;
    const title = (Array.isArray(relation) ? relation[0] : relation)?.title;

    return runAudited(
      admin,
      decision === "exclude" ? "play.exclude" : "play.include",
      { type: "play", id: play.id, label: title },
      {
        reason: reason || undefined,
        from: play.counted ? "counted" : "excluded",
        to: wantCounted ? "counted" : "excluded",
        previous_reason: play.excluded_reason ?? undefined,
      },
      async () => {
        const { data, error: updateError } = await db
          .from("plays")
          .update({
            counted: wantCounted,
            excluded_reason: wantCounted ? null : `${ADMIN_REASON_PREFIX}${reason}`,
          })
          .eq("id", play.id)
          .eq("counted", play.counted)
          .select("id");
        ensure(updateError, "The database refused the change");
        if (data?.length !== 1) throw new ActionError("The play changed in the meantime. Reload the page.");
        return { message: wantCounted ? "The play counts again." : "The play is excluded and no longer counts." };
      }
    );
  });
}

export async function resolveFraudEvent(_state: ActionState | undefined, formData: FormData): Promise<ActionState> {
  return actionResult(async () => {
    const admin = await requireAdmin();
    const eventId = formUuid(formData, "eventId");
    const decision = formText(formData, "decision");
    if (decision !== "resolve" && decision !== "reopen") throw new ActionError("Invalid decision.");
    const note = formReason(formData, "note", false);

    const db = supabaseAdmin();
    const { data: event, error } = await db
      .from("fraud_events")
      .select("id, event_type, resolved")
      .eq("id", eventId)
      .maybeSingle();
    ensure(error, "Could not read the fraud event");
    if (!event) throw new ActionError("Fraud event not found.");

    const resolve = decision === "resolve";
    if (event.resolved === resolve) {
      throw new ActionError(resolve ? "This event is already resolved." : "This event is already open.");
    }

    return runAudited(
      admin,
      resolve ? "fraud_event.resolve" : "fraud_event.reopen",
      { type: "fraud_event", id: event.id, label: event.event_type },
      { note: note || undefined, from: event.resolved ? "resolved" : "open", to: resolve ? "resolved" : "open" },
      async () => {
        const { data, error: updateError } = await db
          .from("fraud_events")
          .update({ resolved: resolve, resolved_at: resolve ? new Date().toISOString() : null })
          .eq("id", event.id)
          .eq("resolved", event.resolved)
          .select("id");
        ensure(updateError, "The database refused the change");
        if (data?.length !== 1) throw new ActionError("The event changed in the meantime. Reload the page.");
        return { message: resolve ? "Event resolved." : "Event reopened." };
      }
    );
  });
}
