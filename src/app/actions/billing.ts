"use server";

import { ActionError, actionResult, runAudited } from "@/lib/actions";
import type { ActionState } from "@/lib/actionTypes";
import { apiPost } from "@/lib/apiClient";
import { requireAdmin } from "@/lib/session";

// Crée dans Stripe le produit et le prix des plans payants qui n'y sont pas encore. C'est l'API
// (qui seule détient la clé Stripe) qui le fait ; l'admin la sollicite avec son jeton. Rejouable
// sans doublon. Journalisée comme toute action.
export async function syncStripePlans(): Promise<ActionState> {
  return actionResult(async () => {
    const admin = await requireAdmin();

    return runAudited(admin, "billing.sync_plans", { type: "billing", label: "Stripe plans" }, {}, async () => {
      const result = await apiPost<{ linked: string[]; alreadyLinked: string[] }>("/stripe/plans/sync");
      if (!result.ok) throw new ActionError(result.error);

      const { linked, alreadyLinked } = result.data;
      return {
        message: linked.length > 0 ? `Created in Stripe: ${linked.join(", ")}.` : "Nothing to create: every paid plan is already in Stripe.",
        details: { linked, already_linked: alreadyLinked },
      };
    });
  });
}
