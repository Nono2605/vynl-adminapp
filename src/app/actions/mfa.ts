"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAdmin } from "@/lib/session";

export interface EnrollmentState {
  error?: string;
  factorId?: string;
  qrCode?: string;
  secret?: string;
}

export interface CodeFormState {
  error?: string;
}

function parseCode(formData: FormData): string | null {
  const code = String(formData.get("code") ?? "").replace(/\s/g, "");
  return /^\d{6}$/.test(code) ? code : null;
}

// Étape 1 de l'enrôlement : crée le facteur TOTP (non vérifié) et renvoie le QR
// code et la clé à saisir à la main. Réservé à un admin qui n'a PAS encore de
// facteur vérifié : sans ça, n'importe quel visiteur connecté pourrait
// manipuler les facteurs d'un compte déjà protégé.
export async function startEnrollment(): Promise<EnrollmentState> {
  const check = await getAdmin();
  if (check.status !== "mfa_setup") return { error: "Not allowed." };

  const supabase = await createClient();

  // Un facteur non vérifié abandonné (page fermée avant le code) bloquerait
  // un nouvel enrôlement : on repart d'une ardoise propre.
  const { data: existing } = await supabase.auth.mfa.listFactors();
  for (const factor of existing?.all ?? []) {
    if (factor.status === "unverified") {
      await supabase.auth.mfa.unenroll({ factorId: factor.id });
    }
  }

  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: "Authenticator app",
    issuer: "Vynl Admin",
  });

  if (error || !data) {
    return {
      error: `Could not start the setup${error ? `: ${error.message}` : "."} Check that TOTP multi-factor auth is enabled in Supabase (Authentication > Sign In / Providers).`,
    };
  }

  return { factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret };
}

// Étape 2 : l'admin saisit le code affiché par son application. Un code
// correct vérifie le facteur et passe la session en AAL2.
export async function confirmEnrollment(
  _state: CodeFormState | undefined,
  formData: FormData
): Promise<CodeFormState> {
  const check = await getAdmin();
  if (check.status !== "mfa_setup") return { error: "Not allowed." };

  const factorId = String(formData.get("factorId") ?? "");
  const code = parseCode(formData);
  if (!factorId) return { error: "Start the setup again." };
  if (!code) return { error: "Enter the 6-digit code." };

  const supabase = await createClient();
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
  if (error) return { error: "That code is not valid. Check the time on your phone and try again." };

  redirect("/");
}

// Connexion suivante : le facteur existe, il faut seulement le code.
export async function verifyCode(
  _state: CodeFormState | undefined,
  formData: FormData
): Promise<CodeFormState> {
  const check = await getAdmin();
  if (check.status !== "mfa_verify") return { error: "Not allowed." };

  const code = parseCode(formData);
  if (!code) return { error: "Enter the 6-digit code." };

  const supabase = await createClient();
  const { data: factors, error: listError } = await supabase.auth.mfa.listFactors();
  const factor = factors?.totp[0];
  if (listError || !factor) return { error: "No authenticator found for this account." };

  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code });
  if (error) return { error: "That code is not valid. Try again." };

  redirect("/");
}
