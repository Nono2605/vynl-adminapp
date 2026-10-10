"use client";

// Champ du code à 6 chiffres. autoComplete="one-time-code" laisse le
// navigateur / le trousseau proposer le code ; inputMode ouvre le clavier
// numérique sur mobile.
export function CodeField() {
  return (
    <input
      type="text"
      name="code"
      placeholder="123456"
      inputMode="numeric"
      autoComplete="one-time-code"
      pattern="[0-9 ]*"
      maxLength={7}
      required
      autoFocus
      className="input-field"
      style={{ letterSpacing: "0.3em", textAlign: "center", fontSize: "1.25rem" }}
    />
  );
}
