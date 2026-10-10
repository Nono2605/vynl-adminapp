"use client";

import { useActionState } from "react";
import type { ServerAction } from "@/lib/actionTypes";

// Formulaire branché sur une Server Action : affiche l'erreur ou la
// confirmation renvoyée, et le « secret » éventuel (montré une seule fois).
// `confirm` demande une confirmation du navigateur avant d'envoyer, pour les
// actions qui touchent quelqu'un.
export function ActionForm({
  action,
  submitLabel,
  pendingLabel,
  tone = "primary",
  confirm,
  children,
}: {
  action: ServerAction;
  submitLabel: string;
  pendingLabel: string;
  tone?: "primary" | "secondary" | "danger";
  confirm?: string;
  children?: React.ReactNode;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);

  return (
    <form
      action={formAction}
      className="action-form"
      onSubmit={
        confirm
          ? (event) => {
              if (!window.confirm(confirm)) event.preventDefault();
            }
          : undefined
      }
    >
      {children}
      {state?.error && (
        <p className="form-error" role="alert">
          {state.error}
        </p>
      )}
      {state?.ok && state.message && (
        <p className="form-ok" role="status">
          {state.message}
        </p>
      )}
      {state?.secret && (
        <div className="secret-box">
          <code>{state.secret}</code>
          <span className="muted">
            Shown once, never stored. Share it securely: the user should change it from their account page.
          </span>
        </div>
      )}
      <button type="submit" disabled={pending} className={`btn btn-sm btn-${tone}`}>
        {pending ? pendingLabel : submitLabel}
      </button>
    </form>
  );
}
