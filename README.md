# Pinpals

Ireland's golf community — Milestone 1: accounts, profiles, and member search.

## Stack

- **Next.js 16** (App Router, Server Actions, Turbopack)
- **Supabase** — Postgres database + Auth (email/password)
- **Tailwind CSS 4** — brand tokens in `src/app/globals.css`
- **Vercel** — hosting (zero-config for Next.js)

## What's built

- `/` — marketing home page
- `/signup`, `/login` — email/password auth via Supabase
- `/auth/confirm` — handles the email confirmation link
- `/profile`, `/profile/edit` — view and edit your own profile (home club, county, handicap, bio)
- `/community` — searchable/filterable member directory (requires login)
- `/courses` — public A–Z directory of all 373 Irish clubs, no login required

Not built yet (next milestones): tee-time invites/messaging, and the marketplace with payments.
The "Connect" button in the directory is intentionally disabled until messaging exists.

## Local setup

1. `npm install`
2. Create a Supabase project (or connect the Supabase MCP connector in Claude and ask Claude to do this for you).
3. Run the SQL in `supabase/migrations/0001_init.sql`, then `supabase/migrations/0002_seed_clubs.sql`, in the Supabase SQL editor (in that order).
4. Copy `.env.local.example` to `.env.local` and fill in your project's URL + anon key (Project Settings → API).
5. `npm run dev` and open http://localhost:3000

## Deploying

Push this repo to GitHub and import it into Vercel, or connect the Vercel MCP connector in Claude
and ask Claude to deploy it directly. Either way, set the same environment variables from
`.env.local` in the Vercel project settings, plus `NEXT_PUBLIC_SITE_URL` set to your real domain
(e.g. `https://pinpals.ie`) so email confirmation links point to the right place.

## Database schema

See `supabase/migrations/0001_init.sql` for the full schema. In short:

- `public.clubs` — the 373-club reference list, readable by everyone.
- `public.profiles` — one row per user, created automatically on sign-up via a trigger.
  Row-level security means anyone signed in can browse the directory, but you can only
  edit or delete your own row.
