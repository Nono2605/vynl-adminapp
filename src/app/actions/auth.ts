"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export interface AuthFormState {
  error?: string;
}

export async function login(
  _state: AuthFormState | undefined,
  formData: FormData
): Promise<AuthFormState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  // Message volontairement unique : on ne dit pas si c'est l'email ou le mot
  // de passe qui est faux. Le rôle admin est vérifié ensuite par requireAdmin()
  // (une connexion réussie d'un non-admin finit sur « not an admin »).
  if (error) {
    return { error: "Invalid email or password." };
  }

  redirect("/");
}

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
