# Memberships: Basic / Premium / Pro

October 2026. Paid tiers members can subscribe to through the App Store or
Google Play (yearly or monthly, cancelled in the store). Branch
`feat/memberships`, migration `0156_memberships.sql`.

**Everything is off.** Two switches, both off:

1. `membership_settings.paid_plans_enabled` (database, `/admin/monetisation`).
   Off = every feature that isn't set to *Off* is free for everyone, whatever
   its level says.
2. `memberships` in `mobile/src/lib/features.ts` (app gate). Off = the app
   fetches nothing, every feature is allowed, the plans screens say "on their
   way".

Approved mock-ups: the "PinPals Memberships" design canvas (superadmin
Monetisation page, Choose your plan, locked-feature upsell, welcome, membership
settings).

## The split

| Basic (free) | Premium (golfers) | Pro (organisers) |
|---|---|---|
| Live scoring, lock-screen entry, certification, societies, tee times, marketplace listings, Rules of Golf, guides | GPS yardages & hole maps, voice scoring, stats, unlimited history, ad-free, featured listings, saved searches, priority tee-time alerts, badge | Everything in Premium + competitions, clubhouse TV, trip itineraries & PDF, society admin tools, branding, societies over 30 |

Prices shown (set the real ones in App Store Connect / Play Console to
match): Premium €4.99/month or €34.99/year, Pro €9.99/month or €69.99/year,
7-day free trial on annual plans. Store product ids:
`pinpals.premium.monthly|annual`, `pinpals.pro.monthly|annual`.

Always free on purpose (not in the catalogue): joining societies and events,
tee times, marketplace listings (commission instead), Rules of Golf, guides.
Marketplace sales, tee times and event fees stay on Stripe — physical goods
and real-world services, outside Apple/Google in-app purchase rules.

## Database (0156)

| Table | What | Read | Write |
|---|---|---|---|
| `membership_settings` | one row: master switch (off), `paid_plans_since` (stamped by trigger), `free_until` launch-offer date, displayed prices, trial days | staff | service role |
| `membership_features` | catalogue of 18 features: group, name, `access` off/free/premium/pro, `when_locked` upsell/hide, `keep_for_existing`, `paywalled_at` (stamped by trigger) | staff | service role |
| `member_entitlements` | member → premium/pro, source app_store/play_store/staff_grant, billing, `expires_at` (null = no end), trial, renew | staff, the member's own row | service role |

Functions (both `authenticated` only, in `function-grants.test.ts`):

- `my_membership()` — my tier (lapsed = basic), the switch, prices, trials.
- `my_feature_access()` — every feature: `allowed`, `access`, `when_locked`.
- `membership_tier_for(uuid)` — internal, nobody else may call it.

**The rule** (SQL in `my_feature_access()`, TS mirror `featureAllowed()` in
`src/lib/memberships.ts` — change both):
off → nobody · free → everyone · paid plans off, or today (Irish date) ≤
`free_until` → free · `keep_for_existing` and the member joined before
greatest(`paywalled_at`, `paid_plans_since`) → allowed · premium → Premium or
Pro · pro → Pro.

RLS tests: `supabase/tests/rls/memberships.test.ts`.

## Website — `/admin/monetisation`

New **Memberships** section in the admin nav (and in the app's Admin menu).
Any staff may look; only **super admin** changes anything (re-checked in every
action). Every change writes `admin_audit_log`
(`membership_settings.updated`, `membership_feature.updated`, with before/after).

- Master switch card: "Paid plans are off" + Turn on/off.
- Counts: Premium, Pro, in a trial, staff grants.
- Plans & prices form: four prices, trial lengths, launch-offer date.
- Feature access: grouped rows, one tap on Off / Free / Premium / Pro saves;
  *Keep for existing members* and *When locked* (show with upgrade / hide)
  enable once a feature is paid.

Files: `src/app/admin/monetisation/{page,actions,feature-row}.tsx|ts`,
`src/lib/admin/memberships.ts` (loader), `src/lib/memberships.ts` (rules,
tested in `memberships.test.ts`).

## App

- `lib/membership-rules.ts` (pure, tested): parse the two functions' answers,
  `gateFor()` → show / locked / hide (**fails open** — no answer, an error or
  an unknown feature shows), plan copy, annual saving, per-month price, button
  wording, renewal line.
- `lib/membership.ts`: `useMembership()` → `{ membership, gate(key), refresh }`,
  five-minute cache, cleared on sign-out.
- Screens: `app/membership/index.tsx` (Choose your plan, `?plan=pro` preselects),
  `app/membership/manage.tsx` (my plan, renewal, upgrade, restore, cancel in
  store). `components/upgrade-sheet.tsx` — the locked-feature sheet with copy
  for GPS, voice, stats, competitions, TV.
- No screen is gated by a feature yet: wiring `gate("gps_yardages")` etc. into
  the hole map, stats, competitions… is the next step, done per feature.
- No guide change: nothing a member sees has changed.

## Still to do before turning it on

1. **Apply 0156** to production (SQL editor or `supabase db push`). Safe: paid
   plans stay off.
2. **Store products**: create the four subscriptions in App Store Connect and
   Play Console (needs the company and the Google Play developer account).
3. **RevenueCat**: add `react-native-purchases` (a native module → new
   TestFlight/Play build, not an OTA), wire the plans screen's button and
   Restore, and a webhook (Supabase Edge Function) that upserts
   `member_entitlements` with the service role.
4. **Gate each feature** in its screens with `gate(key)` + `UpgradeSheet`.
5. Turn on `memberships` in `features.ts` (update `features.test.ts`), OTA.
6. Last: `/admin/monetisation` → **Turn paid plans on** (optionally with a
   launch-offer date first).

## Verified / not verified

Verified: migration replay 0001→0156 and the whole RLS suite (894 tests) on
local Postgres 16; site `tsc`, full unit suite (1,661 tests), ESLint on the
new site files; app `tsc`; `membership-rules.test.ts`, `features.test.ts`.

Not verified: the admin page in a browser against real data; the app screens
on a device.
