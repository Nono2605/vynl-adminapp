"use server";

import { randomInt } from "node:crypto";
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
import { requireAdmin } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase/admin";

// ~100 ans : Supabase Auth n'a pas de « bannissement définitif », on utilise
// une durée. « none » lève le bannissement.
const BAN_FOREVER = "876000h";
const ROLES = ["listener", "creator", "admin"] as const;

interface Target {
  id: string;
  email: string;
  role: string;
  status: string;
}

async function loadTarget(id: string): Promise<Target> {
  const { data, error } = await supabaseAdmin()
    .from("users")
    .select("id, email, role, status")
    .eq("id", id)
    .maybeSingle();
  ensure(error, "Could not read the account");
  if (!data) throw new ActionError("Account not found.");
  if (data.status === "deleted") throw new ActionError("This account is deleted and cannot be changed.");
  return data as Target;
}

// Suspendre = deux choses : users.status (ce que lit l'app) ET un bannissement
// dans Supabase Auth (le compte ne peut plus ouvrir de session ni rafraîchir la
// sienne). L'un sans l'autre laisserait une porte ouverte. Un jeton déjà émis
// reste valable jusqu'à son expiration (≤ 1 h) côté Supabase ; l'API refuse en
// plus les comptes non actifs.
export async function setUserStatus(_state: ActionState | undefined, formData: FormData): Promise<ActionState> {
  return actionResult(async () => {
    const admin = await requireAdmin();
    const id = formUuid(formData, "userId");
    const next = formText(formData, "status");
    if (next !== "active" && next !== "suspended") throw new ActionError("Invalid status.");
    const reason = formReason(formData, "reason", next === "suspended");

    // Pas sur soi-même : cela garantit aussi qu'il reste toujours au moins un
    // admin actif (celui qui agit).
    if (id === admin.id) throw new ActionError("You cannot change the status of your own account.");

    const target = await loadTarget(id);
    if (target.status === next) throw new ActionError(`The account is already ${next}.`);

    const db = supabaseAdmin();
    const banFor = (status: string) => (status === "suspended" ? BAN_FOREVER : "none");

    return runAudited(
      admin,
      next === "suspended" ? "user.suspend" : "user.reactivate",
      { type: "user", id, label: target.email },
      { reason: reason || undefined, from: target.status, to: next },
      async () => {
        const { error: authError } = await db.auth.admin.updateUserById(id, { ban_duration: banFor(next) });
        ensure(authError, "Could not update the sign-in block");

        const { data, error } = await db
          .from("users")
          .update({ status: next })
          .eq("id", id)
          .eq("status", target.status)
          .select("id");

        if (error || data?.length !== 1) {
          // Compensation : on remet Auth dans l'état d'avant.
          await db.auth.admin.updateUserById(id, { ban_duration: banFor(target.status) });
          ensure(error, "Could not update the account status");
          throw new ActionError("The account changed in the meantime. Reload the page.");
        }

        return { message: next === "suspended" ? `${target.email} is suspended.` : `${target.email} is active again.` };
      }
    );
  });
}

export async function setUserRole(_state: ActionState | undefined, formData: FormData): Promise<ActionState> {
  return actionResult(async () => {
    const admin = await requireAdmin();
    const id = formUuid(formData, "userId");
    const next = formText(formData, "role");
    if (!(ROLES as readonly string[]).includes(next)) throw new ActionError("Invalid role.");
    const reason = formReason(formData, "reason", true);

    if (id === admin.id) throw new ActionError("You cannot change your own role.");

    const target = await loadTarget(id);
    if (target.role === next) throw new ActionError(`The account is already a ${next}.`);

    // Donner ou retirer les droits d'admin se confirme en retapant l'email :
    // c'est la seule action qui change QUI peut tout faire.
    if (next === "admin" || target.role === "admin") {
      if (formText(formData, "confirmEmail").toLowerCase() !== target.email.toLowerCase()) {
        throw new ActionError("To change admin rights, type the account's email address to confirm.");
      }
    }

    return runAudited(
      admin,
      "user.set_role",
      { type: "user", id, label: target.email },
      { reason, from: target.role, to: next },
      async () => {
        const { data, error } = await supabaseAdmin()
          .from("users")
          .update({ role: next })
          .eq("id", id)
          .eq("role", target.role)
          .select("id");
        ensure(error, "Could not change the role");
        if (data?.length !== 1) throw new ActionError("The account changed in the meantime. Reload the page.");
        return { message: `${target.email} is now a ${next}.` };
      }
    );
  });
}

// Sans ambiguïtés visuelles (pas de 0/O, 1/l/I).
const PASSWORD_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

function generatePassword(length = 20): string {
  let password = "";
  for (let index = 0; index < length; index += 1) {
    password += PASSWORD_ALPHABET[randomInt(PASSWORD_ALPHABET.length)];
  }
  return password;
}

// Mot de passe temporaire : l'app auditeur n'a pas de parcours « mot de passe
// oublié », donc c'est le seul moyen de dépanner un utilisateur. Le mot de
// passe n'est montré qu'UNE fois à l'admin et n'est écrit nulle part (ni
// journal, ni log). L'utilisateur le change ensuite depuis sa page Compte.
// Refusé pour les comptes admin : un admin change son mot de passe lui-même.
export async function setTemporaryPassword(_state: ActionState | undefined, formData: FormData): Promise<ActionState> {
  return actionResult(async () => {
    const admin = await requireAdmin();
    const id = formUuid(formData, "userId");
    const reason = formReason(formData, "reason", true);

    if (id === admin.id) throw new ActionError("Change your own password from your account settings.");

    const target = await loadTarget(id);
    if (target.role === "admin") throw new ActionError("The password of an admin account cannot be set from here.");

    const password = generatePassword();

    return runAudited(
      admin,
      "user.set_temporary_password",
      { type: "user", id, label: target.email },
      { reason },
      async () => {
        const { error } = await supabaseAdmin().auth.admin.updateUserById(id, { password });
        ensure(error, "Could not set the password");
        return {
          message: `Temporary password set for ${target.email}. Copy it now: it is shown only once.`,
          secret: password,
        };
      }
    );
  });
}
