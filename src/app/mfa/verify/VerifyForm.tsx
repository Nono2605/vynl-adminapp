"use client";

import { useActionState } from "react";
import { verifyCode } from "@/app/actions/mfa";
import { CodeField } from "../CodeField";

export function VerifyForm() {
  const [state, action, pending] = useActionState(verifyCode, undefined);

  return (
    <form action={action} style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
      <CodeField />
      {state?.error && <p style={{ color: "var(--vynl-erreur)" }}>{state.error}</p>}
      <button type="submit" disabled={pending} className="btn btn-primary">
        {pending ? "Checking…" : "Continue"}
      </button>
    </form>
  );
}
