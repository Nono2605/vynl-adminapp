# Vynl Admin

Back-office for Vynl: users, subscriptions, creators, catalog moderation, plays, revenue and payouts.

Next.js 15 (App Router) + Supabase. Same design tokens as the listener app and the Creator Studio.

> This repository is public. Nothing in it is secret and nothing may rely on the code being hidden: every access check happens on the server, and every key lives in environment variables.

## Setup

```bash
npm install
cp .env.example .env.local   # then fill it in
npm run dev                  # http://localhost:3002
```

| Variable | Where to find it | Exposed to the browser |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase > Project Settings > API | yes |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | same | yes |
| `SUPABASE_SECRET_KEY` | same (secret key) | **never** |
| `API_BASE_URL` | the Vynl API on Render (e.g. `https://…onrender.com`, no trailing slash) | no (server only) |

The tables have row level security enabled and no policies, so the secret key is the only way in. It is only read by `src/lib/supabase/admin.ts`, which imports `server-only` so the build fails if a Client Component ever pulls it in.

## First admin account

```bash
npm run create-admin -- you@example.com
```

Asks for the password in the terminal (hidden, never written anywhere), creates the Supabase Auth user, and sets `public.users.role = 'admin'`. Re-run it on an existing account to promote it; add `--reset-password` to change its password.

## Two-step login (TOTP)

Every admin session must reach AAL2: password, then a 6-digit code from an authenticator app. The first time, `/mfa/setup` shows a QR code to scan; afterwards `/mfa/verify` only asks for the code. Requires TOTP to be enabled in Supabase (Authentication > Sign In / Providers > Multi-Factor).

**Lost your phone?** Remove the factor, then log in again and set up a new one. In the Supabase SQL editor:

```sql
delete from auth.mfa_factors where user_id = '<the admin user id>';
```

## Admin actions and the audit log

Before any admin action works, apply `supabase/migrations/20261010100000_admin_actions.sql` once in the Supabase SQL editor. It creates `admin_audit_log` and adds the refusal-reason columns (`tracks.rejection_reason`, `albums.rejection_reason`, `ai_declarations.review_note`).

Every action goes through `runAudited()` (`src/lib/actions.ts`): a `pending` entry is written **before** the change, so if the log is unavailable nothing happens, and the entry is finalized as `success` or `failed` afterwards. A trigger makes finalized entries read-only and undeletable. Never put a secret (password, token) in an entry's details.

What can be done:

- **Users:** suspend / reactivate (sets `users.status` and a Supabase Auth ban; the API also refuses non-active accounts), change role (admin rights need the email typed to confirm), set a temporary password (shown once, never stored). You cannot act on your own account.
- **Publications:** a track or album in review is approved (published) or refused (back to draft, with a reason the creator can read); a published one can be archived and an archived one restored. Publishing a track re-checks the audio file, duration, AI declaration and splits server-side.
- **Review queue:** on `/moderation`, "Review one by one" opens the oldest track (or album) in queue mode (`?flow=1`). Publishing or refusing it opens the next one automatically, "Skip" moves on without deciding, and the queue ends back on `/moderation`. Tracks and albums have separate queues, oldest first. Queue mode skips the browser confirmation on approve/refuse.
- **AI declarations:** declared by the creator, no review needed to publish. An admin can reject the latest declaration of a track (it then blocks publishing, with a note the creator can read) and withdraw that rejection. Statuses are only `declared` and `rejected`: apply `supabase/migrations/20261011100000_ai_declaration_simplify.sql` once (it also drops `reviewed_by` / `reviewed_at`; who, when and why are in the audit log).
- **Plays and fraud:** open a play to see its signals and heartbeats, then exclude it (`counted = false` with an `admin: …` reason, never deleted) or count it again. Fraud events can be resolved or reopened. A play that falls in a closed royalty period (`closed`, `computed`, `published`) cannot be changed. Nothing detects fraud automatically yet: the fraud tables are filled by a detection job that does not exist.

## Analytics

`/analytics` answers where, what and how much people listen: plays, listening time and listeners over a period (7/30/90 days or custom dates, always UTC), by artist, track, country, world region, device, source and listening plan. Filters live in the URL, so a link shares the exact view; the artists, countries and daily series export to CSV (text that looks like a formula is neutralised).

- The figures come from SQL functions (`supabase/migrations/20261011200000_admin_analytics.sql`, apply it once; readable only with the secret key). Definitions match the Studio: a play counts once it has qualified (30 s listened), days are UTC, listeners are distinct accounts.
- Geography stops at the country: the country comes from the visitor's IP as seen by the listener app (the address is never stored) and is not verified. World regions are derived from the country (`src/lib/geo.ts`, UN M49 plus the European Union and Switzerland). No city-level data is collected.
- Everything is aggregated: no page lists people. The only individual view is one account's listening history (`/users/[id]/listening`): opening it writes an entry to the audit log first, and nothing is shown if the log is unavailable.
- `GET /api/health` also reports whether production plays actually carry a country, device and IP fingerprint (`collection`), to catch a broken collection early.

## Privacy

Consent and retention live in the API's database (migration `API/supabase/migrations/20261013000000_privacy_consents_and_retention.sql`, applied in the Supabase SQL editor): a `consents` table where each decision is a new row that is never modified, and `privacy_retention_run` / `privacy_retention_preview` to delete raw heartbeats and clear IP fingerprints older than 30 days (not scheduled until the durations are confirmed). A user's page shows their recorded decisions. `GET /api/health` reports `privacy_consents_and_retention`.

## Stripe

This admin holds **no Stripe key**. The API (Render) holds `STRIPE_SECRET_KEY` and talks to Stripe; the Revenue page asks the API for `GET /stripe/status` with the logged-in admin's token (the API checks the token and the admin role) and shows whether the connection works, its mode (test or live) and the account's public identity. A live key is refused by the API unless `STRIPE_ALLOW_LIVE=yes`. Needs `API_BASE_URL` on this deployment.

## Access control

- `src/middleware.ts` refreshes the session and sends anonymous visitors to `/login`. It is **not** the security boundary.
- `requireAdmin()` (`src/lib/session.ts`) is. It validates the user with Supabase Auth (`getUser()`), reads `role` and `status` from `public.users` (never from the JWT), then requires an AAL2 session.
- Call `requireAdmin()` at the top of **every page that reads data and every Server Action**. A layout does not re-run when navigating between pages that share it.

## Deploy (Vercel)

Import this repo on Vercel (framework: Next.js, nothing else to configure) and add the three environment variables above. Put `SUPABASE_SECRET_KEY` in Production only and mark it Sensitive. `NEXT_PUBLIC_*` values are baked in at build time: redeploy after changing them. Every push to `main` deploys.

`GET /api/health` is a public deployment check: it reports (booleans only) which variables are set and whether the secret key can read the database.

## Roadmap

1. Foundations: login, admin guard, shell, first admin account
2. Admin MFA (TOTP), read-only pages: users, subscriptions, creators, catalog, plays (done)
3. Actions with an audit log: suspend, roles, temporary password, publish / refuse / archive, AI declaration rejection (done)
   Next in this area: automatic audio scan (copyright / plagiarism) as one more review check
4. Fraud and play control (done). Money (waiting on the remuneration spec): payments and plans, period calculation and ledger, Stripe Connect (creator KYC and automated payouts)
