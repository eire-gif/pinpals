# Sign in with Apple and Google

**Status (28 Oct 2026): built on branch `social-sign-in`. Nothing shows to
members until the providers are switched on in Supabase (below). The app half
needs a new store build — read "Ship order" before merging.**

One tap to join or log in, on the app and the website, alongside email and
password (which stays).

| | iPhone / iPad app | Android app | Website |
|---|---|---|---|
| Sign in with Apple | ✅ Apple's own sheet (Face ID) | — | optional, later (needs extra Apple setup) |
| Sign in with Google | ✅ Google's page in the secure browser sheet | ✅ same | ✅ |

Apple's rule (Guideline 4.8): an iOS app offering Google sign-in must also
offer Sign in with Apple. Both go live on iOS together.

## How it behaves

- **Buttons appear by themselves.** The app and website read Supabase's public
  settings and only show a provider that's switched on there. Turn a provider
  off in Supabase and its button disappears — no redeploy.
- **New member.** Apple/Google creates the account first, so it has no date of
  birth. The database holds it as `junior_pending` (signed in, nothing else,
  hidden like a minor) until one is saved (0193). The app's **Finish joining**
  screen (`app/age/date-of-birth.tsx`) asks for the date of birth — and a name
  if Apple didn't share one — then goes to the profile builder. On the website
  the welcome profile page and every age-gated page show the same card.
  Under 13 is refused exactly as on the form; 13–15 go on to the parent step.
- **Names.** Google's name lands on the profile. Apple gives a name only on the
  very first sign-in; the app saves it straight away. Otherwise the profile
  says "New Golfer" until Finish joining replaces it.
- **Same email = same account.** A member who joined with email and later taps
  Google with that address gets their existing account (Supabase links them).
  Apple's "Hide My Email" gives a relay address, so that's a separate account.
- **Hid their email by mistake?** Finish joining has "Already have a PinPals
  account? Use that instead": it removes the new account (only while it's
  empty — Apple/Google-only, under a week old, still held for a date of
  birth — and revokes Apple's grant) and goes back to log in
  (`src/lib/auth/discard-new-account.ts`, `POST /api/app/account/discard-new`).
- **Connect Apple / Google** to an existing account: Privacy & security →
  Ways to sign in, in the app (`components/sign-in-methods.tsx`) and on the
  website (`/profile/privacy`, Google only). Needs **Allow manual linking** on
  in Supabase → Authentication → Sign In / Providers.
- **Mobile number, disclaimer/GDPR**: unchanged — collected where they are now.
- **Deleting the account.** Members without a password confirm on the website
  by having signed in within the last 15 minutes instead of typing a password
  (the app never asked for a password). Deletion revokes their Sign in with
  Apple grant with Apple (Guideline 5.1.1(v)) — needs the Apple key below.

## Where things are

| Piece | File |
|---|---|
| Database: names, the date-of-birth hold, Apple tokens | `supabase/migrations/0193_social_sign_in.sql` (tests: `supabase/tests/rls/social-sign-in.test.ts`) |
| App: sign-in logic | `mobile/src/lib/social-sign-in.ts`, `social-sign-in-rules.ts` (+ test) |
| App: buttons on Log in / Sign up | `mobile/src/components/social-sign-in-buttons.tsx` |
| App: Google's return link | `mobile/src/app/auth-callback.tsx` (`pinpals://auth-callback`) |
| App: Finish joining | `mobile/src/app/age/date-of-birth.tsx` |
| App: native modules | `expo-apple-authentication`, `expo-web-browser`, `expo-crypto`; checked in `native-capabilities.ts` |
| Website: buttons, action, callback | `src/components/auth/social-sign-in-buttons.tsx`, `src/app/auth/social/actions.ts`, `src/app/auth/callback/route.ts` |
| Website: which providers are on | `src/lib/auth/social-providers.ts` |
| Apple token keep/revoke | `src/lib/apple-sign-in.ts`, `POST /api/app/apple/token`, called from `src/lib/account-deletion.ts` |

## Ship order

1. **Apply `0193_social_sign_in.sql`.** Safe on its own: it only affects
   accounts created by Apple/Google, and none exist yet.
2. **Do the setup below** (any order; buttons stay hidden until it's done).
3. **Merge the PR** — Vercel deploys the website. Google appears on
   pinpals.ie as soon as it's switched on in Supabase.
4. **Straight away, a new app build**: from the Codespace,
   `git pull origin main`, `cd mobile`, `eas build --platform all --profile production`,
   then submit to TestFlight / Play. ⚠️ The three new native modules change
   the app's runtime fingerprint. After merging, the next `eas update`
   only reaches phones with the new build, so current TestFlight testers
   get no updates until they install it. Merge only when you're ready to
   build that day.

## Setup (dashboards — not code)

### Supabase → Authentication → URL Configuration → Redirect URLs

Add:

```
pinpals://auth-callback
https://www.pinpals.ie/auth/callback
https://pinpals.ie/auth/callback
```

### Google

1. Google Cloud console (the same project as the map tiles is fine) →
   **APIs & Services → OAuth consent screen**: External; app name PinPals;
   support email; logo; authorised domain `pinpals.ie`; scopes `openid`,
   `email`, `profile`. Publish it ("In production").
2. **Credentials → Create credentials → OAuth client ID → Web application.**
   Authorised redirect URI:
   `https://cicluiabimxklgmpmxmn.supabase.co/auth/v1/callback`
3. Supabase → **Authentication → Sign In / Providers → Google**: enable,
   paste the Client ID and Client Secret, save.

Note: Google's page will say "to continue to cicluiabimxklgmpmxmn.supabase.co"
unless Supabase's custom-domain add-on is used (e.g. auth.pinpals.ie).

### Apple (app)

1. Apple Developer → **Certificates, IDs & Profiles → Identifiers →
   ie.pinpals.app**: tick **Sign in with Apple** (EAS usually does this on the
   next build because `usesAppleSignIn` is set — check it's ticked).
2. Supabase → **Providers → Apple**: enable; **Client IDs**: `ie.pinpals.app`.
   The secret key field is only for the website; leave it empty for now.
3. For deletion to revoke Apple's grant: Apple Developer → **Keys → +**,
   tick Sign in with Apple, configure it with primary App ID ie.pinpals.app,
   download the `.p8` (once only). In Vercel add
   `APPLE_SIGN_IN_KEY_ID` (the key's ID) and `APPLE_SIGN_IN_PRIVATE_KEY`
   (the .p8 contents), then redeploy.

### Apple on the website (optional, later)

Needs a Services ID (e.g. `ie.pinpals.web`) with domain `pinpals.ie` and
return URL `https://cicluiabimxklgmpmxmn.supabase.co/auth/v1/callback`, added
to Supabase's Apple Client IDs, plus a generated secret key (it expires every
six months). Then set `WEB_APPLE_SIGN_IN=1` in Vercel to show the button.

## Test

- iPhone (new build): Log in → Continue with Apple → Finish joining asks for
  date of birth (and name if hidden) → profile builder. Repeat with Google.
- Website: Continue with Google → welcome profile page with the date-of-birth
  card; try tee times before saving it (should ask for the date of birth).
- A date under 13 is refused; a 14-year-old date goes to the parent step.
- Delete a Google-only account on the website: no password box; works within
  15 minutes of signing in.
