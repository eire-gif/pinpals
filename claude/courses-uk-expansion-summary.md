# Courses → UK & Ireland expansion — what shipped

Branch `courses-uk-and-ireland`, commits `13ac79f` and `78fa447`. Migrations 0061–0064 are
**already applied to the live `pinpals` project**; the code is committed but **not pushed**.

## What the directory holds now

| Country | Clubs | With a website | With coordinates |
|---|---|---|---|
| England | 1,400 | 774 (55%) | 1,400 (100%) |
| Scotland | 564 | 507 (90%) | 564 (100%) |
| Ireland | 429 | 120 (28%) | 320 (75%) |
| Wales | 168 | 47 (28%) | 168 (100%) |
| Northern Ireland | 94 | 20 (21%) | 94 (100%) |
| **Total** | **2,655** | **1,468 (55%)** | **2,546 (96%)** |

Before this, the whole directory was 373 club names — no county, no website, no coordinates,
nothing clickable.

## The five things asked for

1. **UK courses, by country.** Imported from OpenStreetMap per country, using the ISO
   3166-2 boundary rather than a bounding box, so the country assignment is exact.
2. **Country dropdown on "Courses".** The header item is now a dropdown of the five
   countries; the same array drives the mobile sheet, so the two can't drift. The parent
   link still goes to `/courses` — the menu is a shortcut, not a gate.
3. **A page per country, and per course.** `/courses/[country]` is searchable, filtered and
   paginated in the database. `/courses/[country]/[slug]` carries the club's website link
   (where one exists) and a maps link, plus the members who play there, its open tee times,
   and a one-click "set as my home club".
4. **Joining is country-first.** Country, then club. The club picker asks the server for one
   country's clubs at a time instead of bundling every name into the browser, and the profile
   now stores a real reference (`home_club_id`) rather than a matched string.
5. **Country on profiles and in search.** Shown on member cards and profile pages, and a
   country filter added to Find Golfers.

## Decisions worth remembering

- **Northern Ireland is its own country here**, so the UK reads correctly by country. That
  splits the island, which is not how Golf Ireland organises the sport — the Ireland and
  Northern Ireland pages cross-link and the landing page says so plainly.
- **Club names are no longer unique.** England has several "Manor Golf Club"s. The
  name-keyed foreign key from `profiles` and the unique constraint behind it were both
  dropped (0062); `clubs.slug` carries uniqueness now. Anywhere a club is *displayed*, show
  the county beside it or two different clubs look like one.
- **`county` columns were not renamed.** They hold a region whose vocabulary depends on the
  country. `src/lib/regions.ts` owns those lists, and every region name is unique across the
  five countries — which is what lets a listing's country be derived from the county the
  seller picked, with no second dropdown.
- **The importer never fuzzy-matches.** A seeded Irish club name that no OSM record matched
  exactly is left alone rather than merged into the nearest-looking course; a wrong merge
  would silently repoint every member whose home club it is.

## Known gaps

- **Region is missing on almost every imported row.** OpenStreetMap rarely carries an address
  county for a golf course — Wales came back with 168 courses and zero counties. The country
  pages fall back to name and town search, the region filter only offers regions that have
  courses behind them, and `/admin/clubs` lists the gaps for filling by hand. Fixing this
  properly means a point-in-polygon pass against county boundaries, which needs a boundary
  dataset this environment couldn't reach.
- **109 seeded Irish club names never matched an OSM record.** They're in the directory with
  `source = 'seed'` — names only. Some are genuine clubs OSM words differently, some are
  probably closed. `/admin/clubs?gap=unmatched` lists them.
- **Town coverage is thin** (19–50% depending on country), same cause.
- **England looks light** at 1,400 against a published ~1,888. That figure counts *courses*,
  not clubs — a 36-hole club is two courses, one membership — so the numbers are probably
  consistent, but it's worth a second import run to confirm nothing was shed under load.
- **Currency.** Listings price in euro. A Manchester seller is a problem the day they arrive,
  and this work makes them likelier. `listings.currency` exists; the UI doesn't use it.
- **Delivery options** still assume domestic Ireland.

## Operational notes

- `supabase/functions/import-courses` is deployed and idempotent. Run it from
  `/admin/clubs` (admin or super_admin), one country at a time. It takes two to three
  minutes per country, so the button reports "started" and the per-country counts on that
  page are how you confirm it landed.
- Courses marked **verified** keep their website, county, town and coordinates through future
  imports — only their country is corrected. Courses marked **manual** are never touched.
- The data is ODbL-licensed. The `OsmAttribution` component renders the required credit;
  add it to any new page that shows course data.
- `pg_net` and `http` extensions were enabled on the database to invoke the Edge Function
  during this work. Neither is needed by the app itself — they can be dropped.

## Verified

`npm run lint`, `npm run typecheck`, `npm run test` (453 passing) and `npm run build` all
clean. Supabase security advisor reports no new findings. All 6 existing profiles, 3 tee-time
posts and 11 listings migrated with correct country and club references.
