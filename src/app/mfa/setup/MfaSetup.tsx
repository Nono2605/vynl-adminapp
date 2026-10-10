"use client";

import { useActionState, useState, useTransition } from "react";
import { confirmEnrollment, startEnrollment, type EnrollmentState } from "@/app/actions/mfa";
import { CodeField } from "../CodeField";

export function MfaSetup() {
  const [enrollment, setEnrollment] = useState<EnrollmentState | null>(null);
  const [starting, startTransition] = useTransition();
  const [state, action, confirming] = useActionState(confirmEnrollment, undefined);

  function start() {
    startTransition(async () => {
      setEnrollment(await startEnrollment());
    });
  }

  if (!enrollment?.factorId) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
        {enrollment?.error && <p style={{ color: "var(--vynl-erreur)" }}>{enrollment.error}</p>}
        <button type="button" onClick={start} disabled={starting} className="btn btn-primary">
          {starting ? "Preparing…" : "Set up authenticator"}
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
      <p style={{ color: "var(--vynl-texte-2)" }}>
        Scan this QR code with an authenticator app (1Password, Google Authenticator, Authy…), then enter the code it
        shows.
      </p>
      {enrollment.qrCode && (
        <div className="qr-box">
          {/* Données SVG fournies par Supabase : next/image n'apporterait rien. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={enrollment.qrCode} alt="QR code to add Vynl Admin to your authenticator app" width={200} height={200} />
        </div>
      )}
      {enrollment.secret && (
        <p style={{ color: "var(--vynl-texte-3)", fontSize: "0.8125rem" }}>
          Can&apos;t scan? Enter this key manually:
          <br />
          <code className="secret">{enrollment.secret}</code>
        </p>
      )}
      <form action={action} style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
        <input type="hidden" name="factorId" value={enrollment.factorId} />
        <CodeField />
        {state?.error && <p style={{ color: "var(--vynl-erreur)" }}>{state.error}</p>}
        <button type="submit" disabled={confirming} className="btn btn-primary">
          {confirming ? "Checking…" : "Activate"}
        </button>
      </form>
    </div>
  );
}
