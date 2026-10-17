# Junior members — 13 and over (Oct 2026)

**Status: built on branch `junior-members`. Needs migration 0159 applied, the
PR merged (Vercel deploys the website), then `eas update`. The app store age
signals need a new native build (see the end); everything else is OTA.**

PinPals was 18+. It now takes golfers from 13, with what they can do set by
their age, worked out from the date of birth every time (never stored), so a
birthday upgrades an account by itself.

## The bands

| | 13–15 | 16–17 | 18+ |
|---|---|---|---|
| Needs a parent | yes — a parent's PinPals account (18+) approves the link | no | no |
| Live scoring, scorecards, GPS, hole maps | ✅ once approved | ✅ | ✅ |
| Share a live round / Follow my round | ✅ | ✅ | ✅ |
| Play with PinPals | parent, contacts the parent approves, people in a group with them | anyone | anyone |
| PinPals (connections) | ❌ — approved contacts instead | ✅ | ✅ |
| Groups & societies | join their parent's groups only; no officer roles; can't create | join only; no officer roles; can't create | ✅ |
| Tee times | ❌ | ❌ | ✅ |
| Social (posts, comments, likes, course reviews) | ❌ (feed comes back empty) | ❌ | ✅ |
| Chat / messages | ❌ (nobody can start one with them) | ❌ | ✅ |
| Marketplace | browse; **Ask a parent** sends the item to the parent | browse; Ask a parent = share sheet | ✅ |
| Profile | seen only by parent, contacts, people they play with; surname as initial | seen by PinPals and people they play with | normal |
| Adverts | no alcohol/betting, no county/club/country targeting | same | normal |

Bands in the database (`age_band_of`, `my_age_access`): `junior_pending`
(13–15, no parent yet — can sign in, nothing else), `junior`, `youth` (16–17,
or anyone flagged "may be under 18" until staff resolve it), `adult`, and
`unknown` (no date of birth yet — members from before this; treated as adults
and asked for a date).

## Age checks (proportionate, no paid ID checks)

1. **Date of birth at sign-up**, a plain "Date of birth" field. Under 13 is
   turned away and the form locks for 24 hours on that device. Locked after:
   only staff can change it (`member_birthdates_guard`).
2. **Parent link for 13–15.** The parent's email is asked for on the
   sign-up form; they get an email with a link (`/parent#<secret>`, only the
   SHA-256 is stored). They sign in (or join) with their own account, which
   must be 18+ by its own date of birth, tick consent and approve.
   Optional **€0 card check** (Stripe Checkout in setup mode, card detached
   straight after) — switch on in /admin (`age_settings.require_parent_card_check`).
3. **App store signals.** Apple Declared Age Range / Google Play Age Signals,
   read by the app once a day. An upper bound under 18 on an 18+ account
   flags it (`member_age_flags`, reason `store_signal`) → treated as 16–17
   until staff look.
4. **Report.** "May be under 18" is a report category (`underage`). Staff
   review on the member's admin page: restrict / clear / correct the date.

## Enforcement

One trigger function, `age_guard()`, on every table a restricted action
writes to (tee times, Social, chat, marketplace, groups, connections, live
rounds and players). Triggers run however the row is written — PostgREST or
any SECURITY DEFINER function — so new screens can't route around them.
Service-role code (`auth.uid()` null) is trusted. Reads: a restrictive policy
on `profiles` (`profile_visible_to_me`) and on `posts`/`post_comments`.
`member_suggestions`, `ads_for_me` and `live_can_add_player` are wrapped (the
originals renamed `*_all`): **later migrations must replace the `*_all`
function, not the wrapper.**

## Contract (app ↔ website ↔ database)

| What | Where |
|---|---|
| Everything a screen needs: band, age, `needsDateOfBirth`, `underReview`, `parent` {status, email, invitedAt, approvedAt}, `can` {liveScoring, shareLive, teeTimes, social, chat, marketplace 'browse'/'full', createGroups, groupOfficer, joinGroups 'none'/'parent'/'all', connections, playWith 'none'/'approved'/'all', personalisedAds} | `rpc my_age_access()` (also restores the surname at 16 and sends one alert when a birthday moves the band) |
| Existing member enters their date (once) | `rpc set_my_date_of_birth(p_date)` → same JSON |
| Sign-up | `POST /api/app/signup` {firstName, lastName, email, password, dateOfBirth, parentEmail?} → `{ok, needsParent}`; 400 `{error, code: "under_13"}`. The 13 minimum is also enforced in the sign-up trigger, for sign-ups sent straight to Supabase Auth |
| New/changed parent email (junior) | `POST /api/app/age/parent` {email} (bearer) |
| Ask a parent about a listing | `POST /api/app/age/ask-parent` {listingId} (bearer) → `{sent}` |
| Store signal | `rpc report_store_age_signal(p_platform, p_lower, p_upper, p_status)` |
| Parent: approve | website `/parent#<secret>` (secret sent as `Authorization: Parent <secret>` to `/api/parent/preview`, `/api/parent/answer`, `/api/parent/card-check`) → `guardian_link_preview` / `guardian_link_accept` / `guardian_link_decline`; Stripe returns to `/parent/card-done`, which approves and detaches the card |
| Parent: dashboard | website `/parent` (also in the app's menu as a web page): `my_children()`, `junior_contact_list` / `junior_contact_set`, `guardian_link_revoke`, add to their groups with `invite_to_group` |
| Staff | Age panel on `/admin/users/[id]`: restrict / clear (`admin_set_age_flag`), correct the date (admin only, audited); card-check switch on `/admin/age` |

Notification types: `age_band_changed`, `parent_link_approved`,
`junior_ask_parent`.

## To ship

1. Apply `0159_junior_members.sql` (no `drop table`; the Supabase tool takes it in one go).
2. Merge the PR; let Vercel deploy.
3. Codespace: `git pull origin main`, `cd mobile`, `eas update`.
4. Store signals (optional, later). The native module is **parked** in
   `mobile/native-later/age-signals`, outside `mobile/modules`, because any
   native module in `mobile/modules` changes the app's runtime fingerprint
   (`runtimeVersion.policy: "fingerprint"`), and then `eas update` publishes
   to a runtime no installed build has: phones never get the update. This
   happened on 17 Oct 2026; parking it put the fingerprint back to the
   installed build's (`d0cc170…`). To switch it on, in one change with a
   new build:
   - move it back: `git mv mobile/native-later/age-signals mobile/modules/age-signals`
   - turn on "Declared Age Range" for `ie.pinpals.app` in the Apple
     Developer portal, then add `"com.apple.developer.declared-age-range": true`
     to `expo.ios.entitlements` in `mobile/app.json` (adding it first would
     break signing)
   - `eas build`, and ship that build before any further `eas update`.
   Its Swift and Kotlin have not been compiled yet. Google's Play Age
   Signals library is still in beta. Until then the app skips the check.
5. Test: sign up as a 14 year old with your own second email as the parent;
   approve from the email; check tee times/Social/chat are gone, live
   scoring works, the parent can add a contact and the child can then add
   them to a round.

## Where things are

| Piece | File |
|---|---|
| Database, triggers, functions | `supabase/migrations/0159_junior_members.sql` |
| RLS tests (25) + grants register | `supabase/tests/rls/junior-members.test.ts`, `function-grants.test.ts` |
| Website: sign-up, rules, tokens | `src/lib/signup.ts`, `src/lib/junior.ts`, `src/lib/parent-link-token.ts`, `src/lib/age-access.ts` |
| Website: parent page + dashboard | `src/app/parent/`, `src/lib/parent-dashboard.ts`, `src/app/api/parent/` |
| Website: gates | `src/components/age/`, used on tee times, feed, conversations, inbox, community, marketplace selling/checkout, dashboard |
| Website: admin | `src/app/admin/users/[id]` (Age panel), `src/app/admin/age`, `src/lib/admin/age.ts` |
| App: access + rules | `mobile/src/lib/age.ts`, `age-rules.ts` (+ tests), flag `ageBands` |
| App: gates | `mobile/src/app/age/date-of-birth.tsx`, `age/waiting.tsx`, `components/not-for-under-18.tsx`, tabs/menu/Home |
| App: Ask a parent, players | `app/listing/[id].tsx`, `live/new.tsx`, `live/day/*` |
| App: store signals | `mobile/native-later/age-signals/` (parked, see To ship 4), `mobile/src/lib/store-age.ts` |
| Guides | `mobile/src/lib/guide.ts` — "Under 16? Getting your parent to approve" and under-18 notes |

## Not done yet

- No privacy notice page exists to link from the parent consent text.
- A minor still sees "Make admin / captain" offered by an owner on their row
  in the app (the database refuses it); the app can't see other members' ages.
- `/dashboard/orders/[id]/checkout` on the website isn't hidden for under-18s
  (the database refuses the order).
