import Link from "next/link";
import { notFound } from "next/navigation";
import { setTemporaryPassword, setUserRole, setUserStatus } from "@/app/actions/users";
import { ActionForm } from "@/components/ActionForm";
import { AuditTrail } from "@/components/AuditTrail";
import { Notice } from "@/components/Notice";
import { PageHead } from "@/components/PageHead";
import { StatCard } from "@/components/StatCard";
import { StatusBadge } from "@/components/StatusBadge";
import { formatDate, formatDateTime } from "@/lib/format";
import { isUuid } from "@/lib/query";
import { requireAdmin } from "@/lib/session";
import { tierOf } from "@/lib/subscription";
import { supabaseAdmin } from "@/lib/supabase/admin";

export default async function UserPage({ params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();

  const { id } = await params;
  if (!isUuid(id)) notFound();

  const db = supabaseAdmin();
  const head = { count: "exact", head: true } as const;

  const [user, profile, subscriptions, artists, onboarding, playlists, library, follows, playsTotal, fraud, consents] =
    await Promise.all([
      db.from("users").select("id, email, role, status, created_at, updated_at").eq("id", id).maybeSingle(),
      db
        .from("profiles")
        .select("username, display_name, country, locale, explicit_content, favorite_genres")
        .eq("user_id", id)
        .maybeSingle(),
      db
        .from("subscriptions")
        .select("id, plan, status, provider, current_period_start, current_period_end, cancel_at_period_end, created_at")
        .eq("user_id", id)
        .order("created_at", { ascending: false }),
      db.from("artists").select("id, name, slug, verified").eq("user_id", id),
      db
        .from("creator_onboarding")
        .select("terms_version, terms_accepted_at, content_provenance, owns_rights, primary_genre")
        .eq("user_id", id)
        .maybeSingle(),
      db.from("playlists").select("id", head).eq("owner_id", id),
      db.from("library").select("id", head).eq("user_id", id),
      db.from("follows").select("id", head).eq("follower_id", id),
      db.from("plays").select("id", head).eq("user_id", id),
      db
        .from("fraud_events")
        .select("id, event_type, severity, detected_at, resolved")
        .eq("user_id", id)
        .order("detected_at", { ascending: false })
        .limit(5),
      // Décisions de vie privée de ce compte (table de l'API, migration 20261013000000).
      db
        .from("consents")
        .select("id, purpose, granted, policy_version, source, created_at")
        .eq("user_id", id)
        .order("created_at", { ascending: false })
        .limit(20),
    ]);

  if (user.error) throw new Error(`Could not load the user: ${user.error.message}`);
  if (!user.data) notFound();

  const account = user.data as { id: string; email: string; role: string; status: string; created_at: string; updated_at: string };
  const subs = (subscriptions.data ?? []) as {
    id: string;
    plan: string;
    status: string;
    provider: string | null;
    current_period_end: string | null;
    cancel_at_period_end: boolean;
  }[];
  const profileData = profile.data as {
    username: string;
    display_name: string | null;
    country: string | null;
    locale: string | null;
    explicit_content: boolean;
    favorite_genres: string[] | null;
  } | null;
  const onboardingData = onboarding.data as {
    terms_version: string;
    terms_accepted_at: string;
    content_provenance: string;
    owns_rights: boolean;
    primary_genre: string | null;
  } | null;
  const artistRows = (artists.data ?? []) as { id: string; name: string; slug: string; verified: boolean }[];
  const consentRows = (consents.data ?? []) as {
    id: string;
    purpose: string;
    granted: boolean;
    policy_version: string;
    source: string;
    created_at: string;
  }[];
  const fraudRows = (fraud.data ?? []) as { id: string; event_type: string; severity: string; detected_at: string; resolved: boolean }[];

  const errors = [profile, subscriptions, artists, onboarding, fraud]
    .map((result) => result.error?.message)
    .filter(Boolean);
  const count = (result: { count: number | null; error: { message: string } | null }) =>
    result.error ? null : result.count;

  return (
    <>
      <p className="muted">
        <Link href="/users" className="text-link">
          Users
        </Link>{" "}
        / {account.email}
      </p>
      <PageHead title={account.email} plain>
        <span style={{ display: "inline-flex", gap: "var(--space-xs)" }}>
          <StatusBadge status={account.role} />
          <StatusBadge status={account.status} />
          <StatusBadge status={tierOf(subs)} />
        </span>
      </PageHead>

      {errors.length > 0 && <Notice>Some sections could not be loaded: {errors[0]}</Notice>}

      <div className="stat-grid">
        <StatCard label="Plays" value={count(playsTotal)} />
        <StatCard label="Playlists" value={count(playlists)} />
        <StatCard label="Library items" value={count(library)} />
        <StatCard label="Follows" value={count(follows)} />
      </div>

      <div className="two-col section-gap">
        <section className="dash-card">
          <h2 className="section-title">Account</h2>
          <dl className="kv">
            <dt>User ID</dt>
            <dd>
              <code>{account.id}</code>
            </dd>
            <dt>Joined</dt>
            <dd>{formatDateTime(account.created_at)}</dd>
            <dt>Updated</dt>
            <dd>{formatDateTime(account.updated_at)}</dd>
          </dl>
        </section>

        <section className="dash-card">
          <h2 className="section-title">Profile</h2>
          {profileData ? (
            <dl className="kv">
              <dt>Username</dt>
              <dd>{profileData.username}</dd>
              <dt>Display name</dt>
              <dd>{profileData.display_name ?? "—"}</dd>
              <dt>Country</dt>
              <dd>{profileData.country ?? "—"}</dd>
              <dt>Language</dt>
              <dd>{profileData.locale ?? "—"}</dd>
              <dt>Explicit content</dt>
              <dd>{profileData.explicit_content ? "Allowed" : "Hidden"}</dd>
              <dt>Favorite genres</dt>
              <dd>{profileData.favorite_genres?.length ? profileData.favorite_genres.join(", ") : "—"}</dd>
            </dl>
          ) : (
            <p className="muted">No profile yet.</p>
          )}
        </section>
      </div>

      {account.status !== "deleted" && (
        <section className="dash-card section-gap">
          <h2 className="section-title">Manage account</h2>
          {account.id === admin.id ? (
            <p className="muted">This is your own account: it cannot be suspended or changed from here.</p>
          ) : (
            <div className="manage-grid">
              <div>
                <h3 className="subsection-title">Access</h3>
                {account.status === "active" ? (
                  <ActionForm
                    action={setUserStatus}
                    submitLabel="Suspend account"
                    pendingLabel="Suspending…"
                    tone="danger"
                    confirm={`Suspend ${account.email}? They will be locked out of Vynl.`}
                  >
                    <input type="hidden" name="userId" value={account.id} />
                    <input type="hidden" name="status" value="suspended" />
                    <textarea
                      name="reason"
                      required
                      minLength={3}
                      maxLength={500}
                      placeholder="Reason (kept in the audit log)"
                      className="input-field"
                    />
                  </ActionForm>
                ) : (
                  <ActionForm action={setUserStatus} submitLabel="Reactivate account" pendingLabel="Reactivating…">
                    <input type="hidden" name="userId" value={account.id} />
                    <input type="hidden" name="status" value="active" />
                    <textarea
                      name="reason"
                      maxLength={500}
                      placeholder="Note (optional, kept in the audit log)"
                      className="input-field"
                    />
                  </ActionForm>
                )}
              </div>

              <div>
                <h3 className="subsection-title">Role</h3>
                <ActionForm
                  action={setUserRole}
                  submitLabel="Change role"
                  pendingLabel="Saving…"
                  tone="secondary"
                  confirm={`Change the role of ${account.email}?`}
                >
                  <input type="hidden" name="userId" value={account.id} />
                  <select name="role" defaultValue={account.role} className="input-field input-field--sm">
                    <option value="listener">listener</option>
                    <option value="creator">creator</option>
                    <option value="admin">admin</option>
                  </select>
                  <textarea
                    name="reason"
                    required
                    minLength={3}
                    maxLength={500}
                    placeholder="Reason (kept in the audit log)"
                    className="input-field"
                  />
                  <input
                    type="email"
                    name="confirmEmail"
                    placeholder="Admin rights only: type the email to confirm"
                    autoComplete="off"
                    className="input-field input-field--sm"
                  />
                </ActionForm>
              </div>

              {account.role !== "admin" && (
                <div>
                  <h3 className="subsection-title">Password</h3>
                  <ActionForm
                    action={setTemporaryPassword}
                    submitLabel="Set a temporary password"
                    pendingLabel="Generating…"
                    tone="secondary"
                    confirm={`Replace the password of ${account.email} with a new temporary one? Their current password stops working.`}
                  >
                    <input type="hidden" name="userId" value={account.id} />
                    <textarea
                      name="reason"
                      required
                      minLength={3}
                      maxLength={500}
                      placeholder="Reason, e.g. support request (kept in the audit log)"
                      className="input-field"
                    />
                  </ActionForm>
                  <p className="muted" style={{ marginTop: "var(--space-xs)" }}>
                    Existing sessions stay open until they expire. There is no &quot;forgot password&quot; page in the app yet.
                  </p>
                </div>
              )}
            </div>
          )}
        </section>
      )}

      <section className="dash-card section-gap">
        <h2 className="section-title">Subscriptions</h2>
        {subs.length === 0 ? (
          <p className="muted">No subscription: free user.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Plan</th>
                  <th>Status</th>
                  <th>Provider</th>
                  <th>Period ends</th>
                  <th>Cancels at period end</th>
                </tr>
              </thead>
              <tbody>
                {subs.map((sub) => (
                  <tr key={sub.id}>
                    <td>{sub.plan}</td>
                    <td>
                      <StatusBadge status={sub.status} />
                    </td>
                    <td>{sub.provider ?? "—"}</td>
                    <td>{formatDate(sub.current_period_end)}</td>
                    <td>{sub.cancel_at_period_end ? "Yes" : "No"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {(artistRows.length > 0 || onboardingData) && (
        <section className="dash-card section-gap">
          <h2 className="section-title">Creator</h2>
          {onboardingData && (
            <dl className="kv" style={{ marginBottom: "var(--space-sm)" }}>
              <dt>Terms accepted</dt>
              <dd>
                {onboardingData.terms_version} · {formatDate(onboardingData.terms_accepted_at)}
              </dd>
              <dt>Content provenance</dt>
              <dd>{onboardingData.content_provenance}</dd>
              <dt>Owns the rights</dt>
              <dd>{onboardingData.owns_rights ? "Yes" : "No"}</dd>
              <dt>Primary genre</dt>
              <dd>{onboardingData.primary_genre ?? "—"}</dd>
            </dl>
          )}
          {artistRows.map((artist) => (
            <p key={artist.id}>
              <Link href={`/catalog?artist=${artist.id}`} className="text-link">
                {artist.name}
              </Link>{" "}
              <span className="muted">/{artist.slug}</span> {artist.verified && <span className="status status--ok">verified</span>}
            </p>
          ))}
        </section>
      )}

      <section className="dash-card section-gap">
        <h2 className="section-title">Listening history</h2>
        <p className="muted" style={{ marginBottom: "var(--space-sm)" }}>
          What this account listens to is personal data. Opening the full history is recorded in the audit log (admin, account,
          time).
        </p>
        <Link href={`/users/${account.id}/listening`} className="btn btn-secondary btn-sm" prefetch={false}>
          Open the listening history
        </Link>
      </section>

      <section className="section-gap">
        <h2 className="section-title">Privacy decisions</h2>
        {consents.error ? (
          <Notice>
            Not available yet ({consents.error.message}). Apply the privacy migration of the API in the Supabase SQL editor.
          </Notice>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Purpose</th>
                  <th>Decision</th>
                  <th>Text version</th>
                  <th>From</th>
                </tr>
              </thead>
              <tbody>
                {consentRows.length === 0 && (
                  <tr>
                    <td colSpan={5} className="empty">
                      No decision recorded: this account has not been through the welcome screen.
                    </td>
                  </tr>
                )}
                {consentRows.map((row) => (
                  <tr key={row.id}>
                    <td>{formatDateTime(row.created_at)}</td>
                    <td>{row.purpose.replace(/_/g, " ")}</td>
                    <td>{row.granted ? <StatusBadge status="approved" /> : <StatusBadge status="rejected" />}</td>
                    <td>{row.policy_version}</td>
                    <td>{row.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {fraudRows.length > 0 && (
        <section className="section-gap">
          <h2 className="section-title">Fraud events</h2>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Detected</th>
                  <th>Type</th>
                  <th>Severity</th>
                  <th>Resolved</th>
                </tr>
              </thead>
              <tbody>
                {fraudRows.map((event) => (
                  <tr key={event.id}>
                    <td>{formatDateTime(event.detected_at)}</td>
                    <td>{event.event_type}</td>
                    <td>{event.severity}</td>
                    <td>{event.resolved ? "Yes" : "No"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="section-gap">
        <h2 className="section-title">Admin activity on this account</h2>
        <AuditTrail targetType="user" targetId={account.id} />
      </section>
    </>
  );
}
