// Crée (ou promeut) un compte administrateur Vynl.
//
//   npm run create-admin -- <email> [--reset-password]
//
// Le mot de passe est demandé dans le terminal, masqué : il n'est ni dans le
// code, ni dans un fichier, ni dans l'historique du shell. Les clés viennent de
// .env.local (voir .env.example).
//
//  * Compte inexistant : créé dans Supabase Auth (email déjà confirmé) puis
//    passé en role = 'admin'. Le trigger handle_new_auth_user crée la ligne
//    public.users en « listener » ; c'est ce script qui la promeut.
//  * Compte existant : seulement promu. Le mot de passe n'est touché qu'avec
//    --reset-password.
//
// Idempotent : on peut le relancer sans risque.

import { createClient } from "@supabase/supabase-js";

const MIN_PASSWORD_LENGTH = 12;

function fail(message) {
  console.error(`\n✗ ${message}`);
  process.exit(1);
}

// Lecture d'une ligne sans écho (mode brut du terminal).
function askHidden(question) {
  return new Promise((resolve) => {
    process.stdout.write(question);
    const { stdin } = process;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");

    let value = "";
    const done = () => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off("data", onData);
      process.stdout.write("\n");
    };
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") {
          done();
          return resolve(value);
        }
        if (ch === "\u0003") {
          done();
          process.exit(130);
        }
        if (ch === "\u007f" || ch === "\b") value = value.slice(0, -1);
        else value += ch;
      }
    };
    stdin.on("data", onData);
  });
}

async function askNewPassword() {
  const first = await askHidden(`Password (min ${MIN_PASSWORD_LENGTH} characters): `);
  if (first.length < MIN_PASSWORD_LENGTH) fail(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  const second = await askHidden("Repeat password: ");
  if (first !== second) fail("Passwords do not match.");
  return first;
}

const args = process.argv.slice(2);
const email = args.find((a) => !a.startsWith("--"))?.trim().toLowerCase();
const resetPassword = args.includes("--reset-password");

if (!email || !email.includes("@")) fail("Usage: npm run create-admin -- <email> [--reset-password]");
if (!process.stdin.isTTY) fail("This script asks for the password: run it in an interactive terminal.");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secretKey = process.env.SUPABASE_SECRET_KEY;
if (!url || !secretKey) fail("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY must be set in .env.local.");

const supabase = createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });

const { data: existing, error: lookupError } = await supabase
  .from("users")
  .select("id, role")
  .eq("email", email)
  .maybeSingle();
if (lookupError) fail(`Could not look the account up: ${lookupError.message}`);

let userId = existing?.id;

if (!userId) {
  const password = await askNewPassword();
  const { data, error } = await supabase.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) fail(`Could not create the account: ${error.message}`);
  userId = data.user.id;
  console.log(`✓ Account created for ${email}`);
} else if (resetPassword) {
  const password = await askNewPassword();
  const { error } = await supabase.auth.admin.updateUserById(userId, { password });
  if (error) fail(`Could not reset the password: ${error.message}`);
  console.log("✓ Password reset");
} else {
  console.log(`Account ${email} already exists (current role: ${existing.role}).`);
}

const { data: promoted, error: promoteError } = await supabase
  .from("users")
  .update({ role: "admin", status: "active" })
  .eq("id", userId)
  .select("id");
if (promoteError) fail(`Could not set the admin role: ${promoteError.message}`);
if (promoted?.length !== 1) fail("The account exists in Auth but has no public.users row; nothing was promoted.");

console.log(`✓ ${email} is an active admin. You can log in.`);
