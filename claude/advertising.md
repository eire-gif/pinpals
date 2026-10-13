# In-app advertising

October 2026. PinPals sells advertising space to golf travel, equipment and
hospitality businesses. Built on branch `feat/advertising`, migration
`0139_advertising.sql`. **Everything is off by default**: the database master
switch (`ad_settings.ads_enabled`) is false and the app flag (`ads` in
`mobile/src/lib/features.ts`) is false. Both must be on for any advert to show.

## What shipped

**Four formats**

| Format | Where | Notes |
|---|---|---|
| Takeover | Full screen, on opening the app and/or after a round is certified | Sponsored pill top-left; a 3 or 5 second countdown ring top-right that becomes a 44pt X ("Close advert"); the whole image opens the link |
| Banner | Slides up above the tab bar on Courses and Marketplace | Once per screen per app session; gold progress bar, hides after 8s; X closes (long-press hides it for good) |
| Feed | Sponsored post in Social, after the 4th post then every 12th | SPONSORED chip, advertiser name/logo, image, link strip with button; ••• → "Hide this advert" (phone-only, kept) and "Why am I seeing this?" |
| Course partner | Strip under the course page title; "Yardages brought to you by …" in the hole map's bottom sheet | In the sheet's flow under the numbers — it never covers the map or a yardage |

Two **display styles**: `artwork` (the advertiser's finished image, shown as is;
PinPals adds only the Sponsored label, countdown and X) and `photo_headline` (a
plain photo; PinPals lays out headline, body and a gold button).

**Never shown**: while signing in, during onboarding, live scoring (`(tabs)/live`),
the hole map, checkout, the in-app web view (which
carries Stripe Checkout), scorecard entry/certify, or to a member in their first
N days (house rule, default 7). An "after a round" takeover requested on the
certify screen waits until the member moves to a free screen.

**Website admin** — new **Advertising** section in the admin nav (any staff may
view; admin / finance / super admin may edit):

- `/admin/advertising` — cards (live campaigns, views 30d, clicks 30d + CTR, ad
  revenue this month with outstanding and the marketplace-banner fees alongside),
  master on/off switch, approval queue, campaign table with All/Live/Scheduled/
  Pending/Ended chips, editable house rules.
- `/admin/advertising/new` and `/[id]` — the five-step form (who and what,
  format, the advert, audience and timing, what they pay) with a live phone
  preview; Save draft / Submit for approval / Approve / Reject / Pause / Resume /
  End. Alcohol and betting can't be approved without the suitability tick
  (also enforced by a table check). Editing an approved advert's content
  (creative, text, link, category, format) sends it back for approval.
- `/admin/advertising/[id]/report` — day-by-day views, clicks, CTR, closes and
  earned, with **Export CSV** (audited as `export.ad_report`). This is what goes
  to the advertiser.
- `/admin/advertising/advertisers` — list, add, edit.
- `/admin/advertising/upload` — the only way into the `ad-creatives` bucket:
  checks type (JPEG/PNG/WEBP), size (≤ 2 MB) and shape, re-encodes with sharp
  (metadata stripped), random file name.
- The marketplace **Revenue** tab gains an **Advertising** card, and its total
  now includes advertising earned in the period (0 until 0139 is applied).
- `/go/ad/[id]` — a counted redirect for links shared outside the app.

Every admin write is a Server Action using the service role, re-checks the role,
and writes `admin_audit_log` (`advertiser.*`, `ad_campaign.*`,
`ad_creative.uploaded`, `ad_settings.updated`, `export.ad_report`).

## Tables (0139)

| Table | What | Who reads | Who writes |
|---|---|---|---|
| `advertisers` | business, contact, website, logo, notes | staff (`is_staff()`) | service role |
| `ad_campaigns` | format, style, creative, text, link, targeting (`countries`, `regions`, `club_ids`), dates, status, weight, pricing, payment, approval and end details | staff | service role; `ad_log()` sets `ended` on a spent cap |
| `ad_settings` | one row: `ads_enabled` (false), `takeover_min_hours_between` (4), `new_member_ad_free_days` (7) | staff | service role |
| `ad_events` | de-duplicated `view` / `click` / `dismiss`, source `app`/`web`, `anonymous` flag | staff | `ad_log()` only |
| `ad_daily_stats` | per campaign per UTC day: `views`, `clicks` (billable), `dismisses`, `anon_views`, `anon_clicks` | staff | `ad_log()` only |

Members never read `ad_campaigns`. They call:

- `ads_for_me(p_country, p_region, p_club_id)` — display fields only of live
  campaigns (approved, inside dates, not capped, master switch on), applying
  country/county/course targeting (falling back to the member's profile), the
  new-member quiet period, and the takeover frequency cap.
- `ad_log(p_campaign_id, p_kind, p_source)` — raises for a campaign that isn't
  live; returns the link for a click. **De-duplication**: a signed-in member's
  view counts once per campaign per clock hour (UTC), a click once per UTC day,
  a dismiss once per hour (unique index on `(campaign, member, kind, window)`).
  Signed-out (website) views/clicks go to `anon_*` and are never billed.
  Rate limits: a member past 60 events a minute, or a campaign past 600
  anonymous events a minute, is ignored.

Country codes are PinPals' own (`ireland`, `northern-ireland`, `england`, …, the
values in `profiles.country`), not ISO codes, because that's what members have.
Counties match `profiles.county`, case-insensitively.

## Revenue rules (`src/lib/advertising-revenue.ts`)

All money in integer cents; numeric strings parsed exactly; divisions round half
to even.

- **flat**: contract = `rate_eur`. Earned = rate × (UTC days begun ÷ total UTC
  days of the run), capped at the rate. A day counts as soon as it starts.
  Pausing or ending early doesn't change it (change the rate if you agree a
  refund). Booked = rate once approved.
- **cpm**: earned = billable views ÷ 1,000 × rate, capped at `budget_cap_eur`.
  Booked = cap if set, else earned.
- **cpc**: earned = billable clicks × rate, same cap and booking.
- Never-approved campaigns (draft, first-time pending, rejected) earn 0. An
  approved advert sent back for re-approval keeps earning.
- **Paid**: `paid` = the full booked amount paid; `waived` = nothing owed;
  `unpaid`/`invoiced` = nothing paid yet. Outstanding = max(0, earned − paid),
  0 when waived.
- **Effective CPM** = earned ÷ views × 1,000. **CTR** = clicks ÷ views.
- Period figures = cumulative earned at the end of the period minus before it,
  so days add up to the total and a cap reached mid-period is exact.
- The cap check matches SQL `ad_campaign_capped()`: CPM/CPC campaigns end
  (`status='ended'`, `end_reason='budget_cap'`) the moment a billable event
  reaches the cap, and stop serving.

## The app (`mobile/`)

- `lib/ads-rules.ts` (pure, tested): row validation (https links only), feed
  slots, weighted pick, blocked screens, takeover gap, "why" wording.
- `lib/ads.ts`: fetch at launch and on return after 10+ minutes away; images
  warmed with `Image.prefetch`; events queued, de-duplicated locally and sent in
  batches (flushed on backgrounding); hidden adverts and the last takeover time
  in `expo-secure-store`. **No new native module** (no expo-image, svg or
  web-browser): links open with `Linking`, so the runtime fingerprint is
  unchanged and it ships over the air.
- `components/ad-takeover.tsx` (host mounted in `app/_layout.tsx`),
  `ad-banner.tsx` (Courses, Marketplace), `sponsored-card.tsx` (Social),
  `course-partner.tsx` (course page, hole map). Each renders nothing with no
  advert, on error, or with ads off.
- The certify screen calls `requestTakeover("after_round")` after a
  successful certification.

No guide change: adverts aren't a member flow covered by `guide.ts`.

## How to turn it on

1. Apply `supabase/migrations/0139_advertising.sql` to production (SQL editor or
   `supabase db push`). Safe on its own: ads stay off.
2. Merge the PR; Vercel deploys the website. The Advertising section appears.
3. Add an advertiser and a campaign, upload creatives, submit, approve.
4. `/admin/advertising` → **Turn advertising on** (sets `ads_enabled`).
5. App: set `ads: true` in `mobile/src/lib/features.ts`, update
   `features.test.ts` (it pins gates off on purpose), commit, then from the
   Codespace: `git pull origin main` and
   `cd mobile && eas update --branch production -m "Flag: ads on"`.

To stop everything at once: turn the master switch off (immediate, no app
release). To stop one advert: Pause or End it.

## Verified / not verified

Verified: `tsc` (site and app), site unit tests (incl. revenue, form rules,
sharp pipeline), app pure-rule tests, `guide.test.ts`, `features.test.ts`, ESLint
(no new warnings), `next build` (webpack, with Google Fonts mocked — the sandbox
can't reach fonts.googleapis.com), full migration replay 0001→0139 and the whole
RLS suite against local Postgres 16, including `advertising.test.ts`.

Not verified: the app on a device or simulator (takeover timing, banner
animation, feed spacing, hole-map sheet height); real uploads to Supabase
Storage; the admin pages in a browser against real data; the Turbopack build
with real fonts. Check those on staging before switching the master switch on.
