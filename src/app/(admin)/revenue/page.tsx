import { ComingSoon } from "@/components/ComingSoon";
import { Notice } from "@/components/Notice";
import { PageHead } from "@/components/PageHead";
import { apiGet } from "@/lib/apiClient";
import { requireAdmin } from "@/lib/session";

type StripeStatus =
  | { configured: false; problem: string }
  | { configured: true; mode: "test" | "live"; ok: false; error: string; code: string | null }
  | {
      configured: true;
      mode: "test" | "live";
      ok: true;
      account: {
        id: string;
        country: string | null;
        default_currency: string | null;
        charges_enabled: boolean;
        payouts_enabled: boolean;
        details_submitted: boolean;
        business_name: string | null;
      };
    };

export default async function RevenuePage() {
  await requireAdmin();

  const result = await apiGet<StripeStatus>("/stripe/status");

  return (
    <>
      <PageHead title="Revenue" />

      <section className="dash-card dash-card--featured">
        <h2 className="section-title">Stripe connection</h2>
        <StripeCard result={result} />
      </section>

      <div className="section-gap">
        <ComingSoon
          title="Subscriptions and payouts"
          intro="Once plans and Checkout are connected, revenue lands here."
          items={[
            "Subscriber payments, refunds and net revenue",
            "Royalty periods: open or closed, total revenue",
            "Allocations per artist and per track",
          ]}
        />
      </div>
    </>
  );
}

function StripeCard({ result }: { result: Awaited<ReturnType<typeof apiGet<StripeStatus>>> }) {
  if (!result.ok) {
    if (result.notConfigured) {
      return (
        <Notice>
          This admin does not know where the API is. In Vercel, add the variable <code>API_BASE_URL</code> (the address of the
          Vynl API on Render, for example <code>https://…onrender.com</code>) and redeploy.
        </Notice>
      );
    }
    if (result.status === 404) {
      return <Notice>The API does not have the Stripe route yet: it may still be deploying. Reload in a minute.</Notice>;
    }
    if (result.status === 401 || result.status === 403) {
      return <Notice>The API refused this request ({result.error}). Your account must be an active admin.</Notice>;
    }
    return <Notice>{result.error}</Notice>;
  }

  const status = result.data;

  if (!status.configured) {
    return (
      <>
        <Notice>{status.problem}</Notice>
        <ol className="muted" style={{ paddingLeft: "1.2rem", display: "flex", flexDirection: "column", gap: "0.35rem" }}>
          <li>In the Stripe dashboard, switch to <strong>test mode</strong>, then Developers &gt; API keys.</li>
          <li>
            Copy the <strong>secret key</strong> (<code>sk_test_…</code>) and add it in Render, on the API service, as{" "}
            <code>STRIPE_SECRET_KEY</code>. Never paste it in a chat, a file or a commit.
          </li>
          <li>Redeploy the API, then reload this page.</li>
        </ol>
      </>
    );
  }

  const live = status.mode === "live";

  return (
    <>
      <p style={{ marginBottom: "var(--space-sm)" }}>
        <span className={`status ${live ? "status--error" : "status--info"}`}>{live ? "live mode" : "test mode"}</span>{" "}
        {status.ok ? <span className="status status--ok">connected</span> : <span className="status status--error">not working</span>}
      </p>

      {live && (
        <Notice>
          The API is using a LIVE Stripe key. Real money is involved. This should only be the case at launch.
        </Notice>
      )}

      {status.ok ? (
        <dl className="kv">
          <dt>Account</dt>
          <dd>
            <code>{status.account.id}</code>
            {status.account.business_name ? ` · ${status.account.business_name}` : ""}
          </dd>
          <dt>Country</dt>
          <dd>{status.account.country ?? "—"}</dd>
          <dt>Default currency</dt>
          <dd>{status.account.default_currency ? status.account.default_currency.toUpperCase() : "—"}</dd>
          <dt>Accepts payments</dt>
          <dd>{status.account.charges_enabled ? "Yes" : "No (normal for a fresh test account)"}</dd>
          <dt>Pays out</dt>
          <dd>{status.account.payouts_enabled ? "Yes" : "No (normal for a fresh test account)"}</dd>
        </dl>
      ) : (
        <Notice>
          Stripe refused the key ({status.error}
          {status.code ? `, ${status.code}` : ""}). Check <code>STRIPE_SECRET_KEY</code> on Render: it must be the secret key of the
          account you expect, in the same mode.
        </Notice>
      )}

      <p className="muted" style={{ marginTop: "var(--space-sm)" }}>
        <a
          href={live ? "https://dashboard.stripe.com/dashboard" : "https://dashboard.stripe.com/test/dashboard"}
          target="_blank"
          rel="noopener noreferrer"
          className="text-link"
        >
          Open the Stripe dashboard
        </a>
      </p>
    </>
  );
}
