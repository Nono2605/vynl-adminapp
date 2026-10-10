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

## Access control

- `src/middleware.ts` refreshes the session and sends anonymous visitors to `/login`. It is **not** the security boundary.
- `requireAdmin()` (`src/lib/session.ts`) is. It validates the user with Supabase Auth (`getUser()`), reads `role` and `status` from `public.users` (never from the JWT), then requires an AAL2 session.
- Call `requireAdmin()` at the top of **every page that reads data and every Server Action**. A layout does not re-run when navigating between pages that share it.

## Deploy (Vercel)

Import this repo on Vercel (framework: Next.js, nothing else to configure) and add the three environment variables above for Production and Preview. Every push to `main` deploys.

## Roadmap

1. Foundations: login, admin guard, shell, first admin account
2. Admin MFA (TOTP), read-only pages: users, subscriptions, creators, catalog, plays
3. Actions with an audit log: suspend, roles, password reset, publish and archive, AI declaration review
4. Money: royalty periods, Stripe Connect (creator KYC and automated payouts), fraud
