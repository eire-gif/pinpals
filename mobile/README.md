# PinPals — mobile app

An Expo (React Native) app for iOS, sharing the live Supabase database with
www.pinpals.ie.

Design and decisions: `claude/ios-app-build-spec.md` in the repo root.

## How this gets built

There is no Node.js on the laptop and no plan to install one. The app follows
the same shape as the website: **the code lives on GitHub and is built in the
cloud.** Nothing is installed locally, and nothing depends on one machine.

| | Website | App |
|---|---|---|
| Source | GitHub | GitHub |
| Build | Vercel | EAS Build (Expo's macOS machines) |
| Triggered by | push to `main` | GitHub Actions, by hand |
| Needs the laptop | no | no |

Config that a cloud build needs is committed in `app.json` under `expo.extra`
— the Supabase URL, the publishable key and the site URL, all of which are
public by design. A `.env` file is only for someone running Metro locally, and
overrides `extra` when present. Nothing secret goes in either.

## The one step that needs a real terminal

EAS can build without you, but the **first** iOS build cannot: that run is what
logs into the Apple Developer account and creates the signing certificate and
provisioning profile, and it has to be able to prompt you. After that, every
build can be non-interactive.

Use a **GitHub Codespace** — a browser-based VS Code with Node already
installed. Free on personal accounts, no install, no admin rights, no IT
conversation:

1. On the repo on github.com: **Code → Codespaces → Create codespace on main**
2. In its terminal:

```bash
cd mobile
npm ci
npm i -g eas-cli
eas login                 # or: eas init --id <project id>
eas init                  # writes the real projectId into app.json — commit it
eas build --platform ios --profile development
```

It will ask for the Apple Developer account and offer to create everything.
Say yes. About fifteen minutes later you get a QR code that installs the app on
the iPhone.

A Codespace is also the first Node terminal this project has ever had, which
means it is where `npm test`, `npm run typecheck` and the RLS replay suite can
finally run — worth remembering before migration 0079 goes anywhere near
production.

## Every build after that

Actions tab → **EAS Build (iOS)** → Run workflow. Needs `EXPO_TOKEN` as a
repository secret; see the comments at the top of
`.github/workflows/eas-build.yml`.

For TestFlight, run the same workflow with the `production` profile, then
`eas submit --platform ios` from a Codespace.

## Layout

```
src/app/_layout.tsx          root layout + auth gate
src/app/login.tsx            email/password sign-in
src/app/(tabs)/index.tsx     tee times      — native, reads Supabase
src/app/(tabs)/marketplace   marketplace    — web view
src/app/(tabs)/notifications alerts         — native, reads Supabase
src/app/(tabs)/profile.tsx   profile        — native shell, links out
src/lib/supabase.ts          client + chunked Keychain session storage
src/lib/auth.tsx             session context
src/lib/config.ts            env / app.json extra, site URL, the ?shell=1 flag
src/components/web-shell.tsx the web view wrapper
```

## Known gaps, in the order they matter

1. **Account deletion does not exist anywhere** — not on the site either.
   App Store Guideline 5.1.1(v) requires it in-app for any app with accounts.
   **Submission is blocked on this.** It has to be built on the website first,
   where it can reconcile with orders, payments and Stripe Connect.
2. **`?shell=1` is not read by the site yet.** Until it is, the web view shows
   the site's own header and nav underneath the native tab bar — the clearest
   possible signal to a reviewer that this is a wrapper (Guideline 4.2). One
   layout flag on the Next side fixes it.
3. **No push yet.** Migration `0079_native_push_tokens.sql` prepares the
   database; the client half (`expo-notifications`, registering the token,
   handling a tap) is the next piece of work.
4. **Icons are Expo placeholders.** `public/icons/` in the web app already has
   PinPals artwork from the PWA work — reuse it.
5. **Nothing here has run on a device yet.** It typechecks; that is all that
   has been proven.
6. **No Sign in with Apple, correctly.** The site is email/password only, so
   Guideline 4.8 does not apply. If Google sign-in is ever added to the site,
   Sign in with Apple becomes mandatory here.
