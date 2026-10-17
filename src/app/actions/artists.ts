"use server";

import { ActionError, actionResult, ensure, formReason, formText, formUuid, runAudited } from "@/lib/actions";
import type { ActionState } from "@/lib/actionTypes";
import { isMissingColumn } from "@/lib/artistNames";
import { isMissingTable } from "@/lib/scans";
import { requireAdmin } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase/admin";

const MIGRATION_HINT =
  "Apply API/supabase/migrations/20261017000000_artist_name_review.sql in the Supabase SQL editor, then try again.";

// Décision sur un nom d'artiste proche d'un nom existant (état « pending » : la page de l'artiste n'est pas
// publique et rien ne peut être soumis tant que personne n'a tranché) :
//  - « approved » : le nom est accepté, la page devient publique ;
//  - « rejected » : le nom est refusé ; le motif, exigé, est lu par l'artiste, qui en choisit un autre.
// Les contrôles de ressemblance en attente pour cet artiste sont clos avec la même décision. Une décision se
// prend une fois : un nom accepté est permanent (catalogue, relevés, pages publiques).
export async function decideArtistName(_state: ActionState | undefined, formData: FormData): Promise<ActionState> {
  return actionResult(async () => {
    const admin = await requireAdmin();
    const artistId = formUuid(formData, "artistId");
    const verdict = formText(formData, "decision");
    if (verdict !== "approved" && verdict !== "rejected") throw new ActionError("Invalid decision.");
    const note = formReason(formData, "note", verdict === "rejected");

    const db = supabaseAdmin();
    const { data: artist, error } = await db
      .from("artists")
      .select("id, name, catalog_code, name_status")
      .eq("id", artistId)
      .maybeSingle();
    if (isMissingColumn(error)) throw new ActionError(`Artist name review is not set up yet. ${MIGRATION_HINT}`);
    ensure(error, "Could not read the artist");
    if (!artist) throw new ActionError("Artist not found.");
    if (artist.name_status === "approved") throw new ActionError("This name is already approved. Reload the page.");
    if (artist.name_status === "rejected") {
      throw new ActionError("This name was already declined: the artist has to choose another one. Reload the page.");
    }

    return runAudited(
      admin,
      verdict === "approved" ? "artist.name.approve" : "artist.name.reject",
      { type: "artist", id: artist.id, label: artist.name },
      { note: note || undefined, catalog_code: artist.catalog_code },
      async () => {
        const decidedAt = new Date().toISOString();
        const { data, error: updateError } = await db
          .from("artists")
          .update({
            name_status: verdict,
            name_review_note: verdict === "rejected" ? note : null,
            name_reviewed_at: decidedAt,
          })
          .eq("id", artist.id)
          .eq("name_status", "pending") // garde de concurrence : on ne tranche que ce qui ne l'est pas encore
          .select("id");
        ensure(updateError, "The database refused the decision");
        if (data?.length !== 1) throw new ActionError("The name changed in the meantime. Reload the page.");

        // Les contrôles de ressemblance en attente pour cet artiste suivent la décision. Au mieux : la décision
        // sur le nom est prise, le journal des contrôles ne doit pas la défaire.
        const scans = await db
          .from("track_scans")
          .update({
            decision: verdict === "approved" ? "dismissed" : "confirmed",
            decided_by: admin.id,
            decided_at: decidedAt,
            decision_note: note || null,
          })
          .eq("artist_id", artist.id)
          .eq("check_kind", "name_similarity")
          .is("decision", null);
        if (scans.error && !isMissingTable(scans.error)) {
          console.error(`Could not close the name checks of artist ${artist.id}: ${scans.error.message}`);
        }

        return {
          message:
            verdict === "approved"
              ? "Name approved: the artist page is now public."
              : "Name declined: the artist will see the reason and choose another name.",
        };
      }
    );
  });
}

// Le badge « verified » affiché dans l'app d'écoute : une marque de confiance posée à la main, journalisée.
export async function setArtistVerified(_state: ActionState | undefined, formData: FormData): Promise<ActionState> {
  return actionResult(async () => {
    const admin = await requireAdmin();
    const artistId = formUuid(formData, "artistId");
    const verified = formText(formData, "verified") === "yes";
    const note = formReason(formData, "note", false);

    const db = supabaseAdmin();
    const { data: artist, error } = await db
      .from("artists")
      .select("id, name, catalog_code, verified")
      .eq("id", artistId)
      .maybeSingle();
    ensure(error, "Could not read the artist");
    if (!artist) throw new ActionError("Artist not found.");
    if (artist.verified === verified) {
      throw new ActionError(`This artist is already ${verified ? "verified" : "not verified"}. Reload the page.`);
    }

    return runAudited(
      admin,
      verified ? "artist.verify" : "artist.unverify",
      { type: "artist", id: artist.id, label: artist.name },
      { note: note || undefined, catalog_code: artist.catalog_code },
      async () => {
        const { data, error: updateError } = await db
          .from("artists")
          .update({ verified })
          .eq("id", artist.id)
          .eq("verified", artist.verified) // garde de concurrence
          .select("id");
        ensure(updateError, "The database refused the change");
        if (data?.length !== 1) throw new ActionError("The artist changed in the meantime. Reload the page.");
        return { message: verified ? "Artist verified." : "Verified badge removed." };
      }
    );
  });
}
