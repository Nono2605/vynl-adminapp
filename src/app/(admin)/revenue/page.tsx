import { syncStripePlans } from "@/app/actions/billing";
import { ActionForm } from "@/components/ActionForm";
import { Notice } from "@/components/Notice";
import { PageHead } from "@/components/PageHead";
import { StatCard } from "@/components/StatCard";
import { StatusBadge } from "@/components/StatusBadge";
import { apiGet } from "@/lib/apiClient";
import { formatDateTime, formatMoney, formatNumber } from "@/lib/format";
import { first } from "@/lib/query";
import { requireAdmin } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { daysAgo } from "@/lib/time";

const MIGRATION = "20261013200000_billing_plans_payments.sql";

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

interface Plan {
  code: string;
  name: string;
  price_cents: number;
  currency: string;
  interval: string;
  tax_behavior: string;
  ad_supported: boolean;
  active: boolean;
  stripe_price_id: string | null;
}

interface Payment {
  id: string;
  plan: string | null;
  currency: string;
  gross_cents: number;
  tax_cents: number;
  fee_cents: number | null;
  refunded_cents: number;
  status: string;
  paid_at: string;
  users: { email: string } | { email: string }[] | null;
}

interface StripeEvent {
  id: string;
  type: string;
  livemode: boolean;
  outcome: string;
  error: string | null;
  received_at: string;
}

function sumBy<T>(rows: T[], pick: (row: T) => [string, number]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const row of rows) {
    const [currency, amount] = pick(row);
    totals.set(currency, (totals.get(currency) ?? 0) + amount);
  }
  return totals;
}

const money = (totals: Map<string, number>): string =>
  totals.size === 0 ? "—" : [...totals.entries()].map(([currency, cents]) => formatMoney(cents, currency)).join(" + ");

export default async function RevenuePage() {
  await requireAdmin();

  const db = supabaseAdmin();
  const head = { count: "exact", head: true } as const;

  const [status, plans, subscriptions, recentPayments, windowPayments, events, failedEvents] = await Promise.all([
    apiGet<StripeStatus>("/stripe/status"),
    db
      .from("plans")
      .select("code, name, price_cents, currency, interval, tax_behavior, ad_supported, active, stripe_price_id")
      .order("price_cents"),
    db
      .from("subscriptions")
      .select("plan, status")
      .eq("provider", "stripe")
      .in("status", ["active", "trialing", "past_due"])
      .limit(5000),
    db
      .from("payments")
      .select("id, plan, currency, gross_cents, tax_cents, fee_cents, refunded_cents, status, paid_at, users(email)")
      .order("paid_at", { ascending: false })
      .limit(20),
    db
      .from("payments")
      .select("currency, gross_cents, tax_cents, fee_cents, refunded_cents")
      .gte("paid_at", daysAgo(30).toISOString())
      .limit(5000),
    db
      .from("stripe_events")
      .select("id, type, livemode, outcome, error, received_at")
      .order("received_at", { ascending: false })
      .limit(15),
    db.from("stripe_events").select("id", head).eq("outcome", "failed"),
  ]);

  const planRows = (plans.data ?? []) as Plan[];
  const subRows = (subscriptions.data ?? []) as { plan: string; status: string }[];
  const paymentRows = (recentPayments.data ?? []) as unknown as Payment[];
  const windowRows = (windowPayments.data ?? []) as {
    currency: string;
    gross_cents: number;
    tax_cents: number;
    fee_cents: number | null;
    refunded_cents: number;
  }[];
  const eventRows = (events.data ?? []) as StripeEvent[];

  // Abonnés : seuls « active » et « trialing » donnent un accès payant (même règle que l'API).
  const active = subRows.filter((sub) => sub.status === "active");
  const trialing = subRows.filter((sub) => sub.status === "trialing").length;
  const pastDue = subRows.filter((sub) => sub.status === "past_due").length;

  // Revenu mensuel récurrent BRUT (taxe comprise) : prix mensuel de chaque abonnement actif.
  const planByCode = new Map(planRows.map((plan) => [plan.code, plan]));
  const mrr = sumBy(active, (sub) => {
    const plan = planByCode.get(sub.plan);
    if (!plan) return ["chf", 0];
    return [plan.currency, plan.interval === "year" ? plan.price_cents / 12 : plan.price_cents];
  });

  const gross = sumBy(windowRows, (row) => [row.currency, row.gross_cents]);
  const tax = sumBy(windowRows, (row) => [row.currency, row.tax_cents]);
  const refunded = sumBy(windowRows, (row) => [row.currency, row.refunded_cents]);
  const feesKnown = windowRows.filter((row) => row.fee_cents !== null);
  const fees = sumBy(feesKnown, (row) => [row.currency, row.fee_cents ?? 0]);

  const unlinked = planRows.filter((plan) => plan.active && plan.price_cents > 0 && !plan.stripe_price_id);
  const stripeReady = status.ok && status.data.configured && status.data.ok;
  const failed = failedEvents.error ? null : (failedEvents.count ?? 0);

  return (
    <>
      <PageHead title="Revenue" />

      <section className="dash-card dash-card--featured">
        <h2 className="section-title">Stripe connection</h2>
        <StripeCard result={status} />
      </section>

      {plans.error && (
        <div className="section-gap">
          <Notice>
            Plans and payments are not available yet ({plans.error.message}). Apply <code>{MIGRATION}</code> (API repository) in the
            Supabase SQL editor.
          </Notice>
        </div>
      )}

      <h2 className="section-title section-gap">Plans</h2>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Plan</th>
              <th>Price</th>
              <th>Tax</th>
              <th>Advertising</th>
              <th>In Stripe</th>
            </tr>
          </thead>
          <tbody>
            {planRows.length === 0 && (
              <tr>
                <td colSpan={5} className="empty">
                  No plan.
                </td>
              </tr>
            )}
            {planRows.map((plan) => (
              <tr key={plan.code}>
                <td className="cell-main">
                  {plan.name} <span className="muted">{plan.code}</span>
                  {!plan.active && <span className="muted"> · inactive</span>}
                </td>
                <td>
                  {plan.price_cents === 0 ? "Free" : `${formatMoney(plan.price_cents, plan.currency)} / ${plan.interval}`}
                </td>
                <td>{plan.price_cents === 0 ? "—" : plan.tax_behavior === "inclusive" ? "Tax included" : "Tax added"}</td>
                <td>{plan.ad_supported ? "Yes" : "No"}</td>
                <td>
                  {plan.price_cents === 0 ? (
                    <span className="muted">Not needed</span>
                  ) : plan.stripe_price_id ? (
                    <StatusBadge status="approved" />
                  ) : (
                    <span className="status status--warn">not yet</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {unlinked.length > 0 && (
        <div style={{ marginTop: "var(--space-sm)", maxWidth: 420 }}>
          {stripeReady ? (
            <ActionForm action={syncStripePlans} submitLabel="Create the plans in Stripe" pendingLabel="Creating…">
              <p className="muted">
                Creates the Stripe product and price for {unlinked.map((plan) => plan.name).join(", ")}. Safe to repeat: nothing is
                duplicated.
              </p>
            </ActionForm>
          ) : (
            <p className="muted">Connect Stripe above first, then the plans can be created there.</p>
          )}
        </div>
      )}

      <h2 className="section-title section-gap">Subscriptions and revenue</h2>
      {subscriptions.error ? null : (
        <div className="stat-grid">
          <StatCard label="Paying subscribers" value={active.length} hint="Active Stripe subscriptions" />
          <StatCard label="On trial" value={trialing} />
          <StatCard label="Payment past due" value={pastDue} warn />
          <StatCard label="Monthly recurring revenue" value={active.length} display={money(mrr)} hint="Gross, tax included" />
        </div>
      )}
      <div className="stat-grid section-gap">
        <StatCard label="Paid, last 30 days" value={windowRows.length} display={money(gross)} hint={`${formatNumber(windowRows.length)} payments, tax included`} />
        <StatCard label="of which tax" value={windowRows.length} display={money(tax)} hint="Belongs to no one (spec Q1)" />
        <StatCard
          label="Stripe fees"
          value={feesKnown.length}
          display={money(fees)}
          hint={feesKnown.length < windowRows.length ? `Known for ${feesKnown.length} of ${windowRows.length} payments` : "Known for every payment"}
        />
        <StatCard label="Refunded" value={windowRows.length} display={money(refunded)} />
      </div>

      <h2 className="section-title section-gap">Latest payments</h2>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Paid</th>
              <th>Account</th>
              <th>Plan</th>
              <th className="num">Paid</th>
              <th className="num">Tax</th>
              <th className="num">Stripe fee</th>
              <th className="num">Net</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {paymentRows.length === 0 && (
              <tr>
                <td colSpan={8} className="empty">
                  No payment yet.
                </td>
              </tr>
            )}
            {paymentRows.map((payment) => (
              <tr key={payment.id}>
                <td>{formatDateTime(payment.paid_at)}</td>
                <td className="cell-main">{first(payment.users)?.email ?? <span className="muted">Deleted account</span>}</td>
                <td>{payment.plan ?? "—"}</td>
                <td className="num">{formatMoney(payment.gross_cents, payment.currency)}</td>
                <td className="num">{formatMoney(payment.tax_cents, payment.currency)}</td>
                <td className="num">{payment.fee_cents === null ? "—" : formatMoney(payment.fee_cents, payment.currency)}</td>
                <td className="num">
                  {payment.fee_cents === null ? "—" : formatMoney(payment.gross_cents - payment.tax_cents - payment.fee_cents, payment.currency)}
                </td>
                <td>
                  <StatusBadge status={payment.status === "paid" ? "approved" : payment.status === "refunded" ? "rejected" : "pending"} />{" "}
                  <span className="muted">{payment.status.replace(/_/g, " ")}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="section-title section-gap">Stripe events</h2>
      {failed !== null && failed > 0 && (
        <Notice>
          {formatNumber(failed)} event{failed > 1 ? "s" : ""} failed to process (Stripe retries them for several days). The error is
          shown below.
        </Notice>
      )}
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Received</th>
              <th>Event</th>
              <th>Mode</th>
              <th>Result</th>
            </tr>
          </thead>
          <tbody>
            {eventRows.length === 0 && (
              <tr>
                <td colSpan={4} className="empty">
                  {events.error ? "Not available yet." : "No event received yet: add the webhook in Stripe (see the README)."}
                </td>
              </tr>
            )}
            {eventRows.map((event) => (
              <tr key={event.id}>
                <td>{formatDateTime(event.received_at)}</td>
                <td className="cell-main">{event.type}</td>
                <td>{event.livemode ? <span className="status status--error">live</span> : <span className="status status--info">test</span>}</td>
                <td>
                  <StatusBadge
                    status={event.outcome === "processed" ? "approved" : event.outcome === "failed" ? "failed" : event.outcome === "ignored" ? "closed" : "pending"}
                  />{" "}
                  <span className="muted">{event.error ?? event.outcome}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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
        <Notice>The API is using a LIVE Stripe key. Real money is involved. This should only be the case at launch.</Notice>
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
