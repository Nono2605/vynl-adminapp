import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export interface AdminUser {
  id: string;
  email: string;
}

export type AdminCheck =
  | { status: "anonymous" }
  | { status: "forbidden"; email: string | undefined }
  | { status: "ok"; admin: AdminUser };

// Vérifie QUI est connecté puis QUEL RÔLE il a. Deux règles :
//  * getUser() (appel à Supabase Auth) et jamais getSession() : la session des
//    cookies n'est pas vérifiée côté serveur, elle peut être forgée.
//  * Le rôle est lu dans public.users, jamais dans le JWT (même règle que
//    requireCreator côté API) : un rôle retiré prend effet immédiatement.
// Enveloppée dans cache() : layout et pages l'appellent tous, une seule requête
// par rendu.
export const getAdmin = cache(async function getAdmin(): Promise<AdminCheck> {
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

  return { status: "ok", admin: { id: data.id, email: data.email } };
});

// À appeler en tête de CHAQUE layout, page et Server Action de l'admin. Le
// middleware ne suffit pas : il ne fait que renvoyer vers /login, et il ne peut
// pas être la seule barrière d'une zone d'administration.
export const requireAdmin = cache(async function requireAdmin(): Promise<AdminUser> {
  const check = await getAdmin();

  if (check.status === "anonymous") redirect("/login");
  if (check.status === "forbidden") redirect("/login?error=forbidden");

  return check.admin;
});
