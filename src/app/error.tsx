"use client";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div style={{ maxWidth: 480, margin: "var(--space-xl) auto", padding: "0 var(--space-md)" }}>
      <h1 className="display-title" style={{ marginBottom: "var(--space-sm)" }}>
        Something broke
      </h1>
      <p style={{ color: "var(--vynl-texte-2)", marginBottom: "var(--space-md)" }}>
        {error.message}
        {error.digest ? ` (ref ${error.digest})` : ""}
      </p>
      <button type="button" onClick={reset} className="btn btn-secondary">
        Try again
      </button>
    </div>
  );
}
