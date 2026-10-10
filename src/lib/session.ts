import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export interface AdminUser {
  id: string;
  email: string;
}

// Les états d'un visiteur face à l'admin, du moins au plus authentifié :
//  * anonymous : pas connecté ;
//  * forbidden : connecté mais pas un admin actif ;
//  * mfa_setup : admin, mais aucun second facteur vérifié -> doit en créer un ;
//  * mfa_verify : admin avec un second facteur, session encore en AAL1 ;
//  * ok : admin, session en AAL2 (mot de passe + code TOTP).
export type AdminCheck =
  | { status: "anonymous" }
  | { status: "forbidden"; email: string | undefined }
  | { status: "mfa_setup"; admin: AdminUser }
  | { status: "mfa_verify"; admin: AdminUser }
  | { status: "ok"; admin: AdminUser };

type AdminIdentity =
  | { status: "anonymous" }
  | { status: "forbidden"; email: string | undefined }
  | { status: "admin"; admin: AdminUser };

// Étape 1 : QUI est connecté, et a-t-il le rôle admin ? Deux règles :
//  * getUser() (appel à Supabase Auth) et jamais getSession() : la session des
//    cookies n'est pas vérifiée côté serveur, elle peut être forgée.
//  * Le rôle est lu dans public.users, jamais dans le JWT (même règle que
//    requireCreator côté API) : un rôle retiré prend effet immédiatement.
const loadAdminIdentity = cache(async function loadAdminIdentity(): Promise<AdminIdentity> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { status: "anonymous" };

  const { data, error } = await supabaseAdmin()
    .from("users")
    .select("id, email, role, status")
    .eq("id", user.id)
    .maybeSingle();

  // Erreur de base ≠ « pas admin » : on laisse error.tsx l'afficher plutôt que
  // de renvoyer un administrateur légitime sur « forbidden ».
  if (error) throw new Error(`Could not load the admin profile: ${error.message}`);

  if (!data || data.role !== "admin" || data.status !== "active") {
    return { status: "forbidden", email: user.email };
  }

  return { status: "admin", admin: { id: data.id, email: data.email } };
});

// Étape 2 : le niveau d'assurance (AAL) de la session. Le niveau vient du JWT
// de la session, celui-là même que getUser() vient de faire valider par
// Supabase Auth à l'étape 1 : on ne lit donc pas un jeton non vérifié.
// Enveloppée dans cache() : layout et pages l'appellent tous, une seule requête
// par rendu.
export const getAdmin = cache(async function getAdmin(): Promise<AdminCheck> {
  const identity = await loadAdminIdentity();
  if (identity.status !== "admin") return identity;

  const supabase = await createClient();
  const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error || !data) {
    throw new Error(`Could not read the session assurance level: ${error?.message ?? "no data"}`);
  }

  if (data.currentLevel === "aal2") return { status: "ok", admin: identity.admin };

  // nextLevel vaut aal2 dès qu'un facteur vérifié existe ; sinon aal1.
  return data.nextLevel === "aal2"
    ? { status: "mfa_verify", admin: identity.admin }
    : { status: "mfa_setup", admin: identity.admin };
});

// À appeler en tête de CHAQUE layout, page et Server Action de l'admin. Le
// middleware ne suffit pas : il ne fait que renvoyer vers /login, et il ne peut
// pas être la seule barrière d'une zone d'administration.
export const requireAdmin = cache(async function requireAdmin(): Promise<AdminUser> {
  const check = await getAdmin();

  switch (check.status) {
    case "anonymous":
      redirect("/login");
    case "forbidden":
      redirect("/login?error=forbidden");
    case "mfa_setup":
      redirect("/mfa/setup");
    case "mfa_verify":
      redirect("/mfa/verify");
    case "ok":
      return check.admin;
  }
});
