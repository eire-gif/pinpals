# Wanted ads (30 Oct 2026, migration 0203)

**Asked (Eire, 30 Oct 2026):** build Wanted ads from the *PinPals Next Ideas*
canvas (row 4).

- **Post:** Marketplace → "Can't find it? Post a wanted ad" → `app/wanted`
  (yours, and what others want — your county or everywhere) and
  `app/wanted/new.tsx` (category, details, shaft and hand for clubs, price
  limit, county or anywhere; shows up to 3 live listings that already fit).
  30 days, ten open at a time, first name and county shown.
- **Matching (database):** `listings_wanted_match` trigger — when a listing
  becomes `active`, every open wanted ad it **fits** (same category; flex,
  hand and county when given; price at or under the limit) gets a
  `wanted_match` notification (href `/marketplace/<id>`, dedupe
  `wanted-<ad>-<listing>`), 50 at most per listing, never blocking the
  listing.
- **Seller side:** on your own live listing, `components/wanted-matches.tsx`
  lists who's looking (`wanted_matches_for_listing`): Fits (already told) and
  Close (up to a third over their price), each with "Send <name> your ad"
  (`wanted_send_listing`, same dedupe so nobody is told twice).
- Visibility: open ads to signed-in members, never across a block; closed or
  expired only to their owner. Writes only through `wanted_save` /
  `wanted_close`.
- Feature flag `wantedAds`; guide steps in Buy gear safely and Sell your gear.
  RLS tests `wanted-ads.test.ts`.

## Not done

- Distance (listings only have a county), push notifications depend on the
  existing notification delivery, no wanted ads on the website yet.
