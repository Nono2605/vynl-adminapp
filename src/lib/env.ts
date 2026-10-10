// Lit une variable d'environnement obligatoire. Une variable manquante donne
// un message qui dit laquelle, au lieu d'un « undefined » obscur plus loin.
export function requireEnv(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Missing environment variable ${name}. See .env.example.`);
  }
  return value;
}
