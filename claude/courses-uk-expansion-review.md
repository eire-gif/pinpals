# Courses → UK & Ireland expansion — review before build

Reviewing the five things asked for:

1. Expand Courses from Ireland-only to the whole UK as well.
2. A country dropdown on the "Courses" nav item, with a page per country.
3. A page per course, with its website (where available) and a clickable location link.
4. Joining criteria becomes country → then club.
5. Country shown on member profiles so it appears when people search.

Verdict: all five are the right shape, and 2–5 are straightforward. **Item 1 — the data
itself — is the whole job.** Everything else is a week of ordinary work sitting on top of a
dataset we don't have yet. Below is what I found in the current code, what breaks, and the
four decisions I need from you before writing anything.

---

## 1. Where Courses is today

Smaller than it looks. There is no courses *system* — there's a JSON file.

- `src/data/clubs.json` — a flat array of **373 club names**. Names only. No county, no
  website, no coordinates, no ID.
- `src/lib/clubs.ts` — exports that array as `CLUBS`, plus `COUNTIES`, a hardcoded list of
  the **32 Irish counties** (so today "Ireland" already means the whole island — Ardglass,
  Ardminnan and Aughnacloy are in there alongside Lahinch).
- `/courses` renders one A–Z page of all 373 names, client-side, filtered by a search box.
  A club on that page is plain text — nothing to click.
- `clubs` table in Supabase: **373 rows, columns `id` and `name` only, and nothing in the
  app reads it.** It was seeded in `0002_seed_clubs.sql` and then never used.

That last point is the good news: the table is free real estate. We can turn `clubs` into
the real source of truth without unpicking any existing reads.

`profiles.home_club` is free text, validated on save against the `CLUBS` array
(`src/app/profile/edit/actions.ts`) — so it's a soft reference, not a foreign key.

## 2. The data problem — this is the blocker

You have 373 clubs, names only. What's being asked for is roughly **3,000 clubs across five
countries, each with a website and a location**. Published figures: England 1,888, Scotland
560, Wales 145, Ireland (all 32 counties) 405 — about 3,000 for UK + Ireland together.
So this is roughly **eight times the current dataset, with three fields we hold for none of
the 373 clubs we already have.**

There is no free, authoritative, licence-clean file with all of that. The realistic options:

**A. OpenStreetMap (Overpass API).** Every golf course in GB and Ireland tagged
`leisure=golf_course`, with name, coordinates, and a `website` tag where someone has added
one. Free, complete-ish on names and coordinates, **patchy on websites** — expect roughly
half to have one. Licence is ODbL: fine to use commercially, but it requires visible
attribution ("© OpenStreetMap contributors") on the Courses pages, and share-alike terms
attach to the derived dataset. It also needs a cleanup pass — driving ranges, pitch & putt
and closed courses come back in the same query, names are inconsistent ("Golf Club" vs
"GC"), and a single course often appears twice as both a way and a relation.

*One practical wrinkle:* this environment can't reach the Overpass API directly (egress is
restricted to GitHub and the package registries). That's not fatal — the import would run
server-side as an admin-only route in the app itself, which is where it belongs anyway so
you can re-run it later to refresh the data. It just means the import is code we ship, not
a one-off script I run here.

**B. A commercial dataset.** Golf-specific providers sell UK/Ireland course data with
verified websites, addresses and phone numbers. Cleanest result, real cost, and worth a
quote if you'd rather not launch on OSM-quality data.

**C. Hybrid — my recommendation.** OSM for the base import of all ~3,000, then an admin
screen where a course's website, address and location can be corrected by hand. The
directory is live from day one, and the ~370 Irish clubs you already care about most get
tidied first. It also means member-submitted corrections have somewhere to land later.

**Whichever we pick, our existing 373 names must be matched against the import, not
appended to it** — otherwise every current member's `home_club` points at a name that now
has a near-duplicate sitting beside it in the list.

## 3. Country taxonomy — the one real decision

"All the courses in the UK, separately by country" and "Ireland" don't cleanly co-exist,
because Northern Ireland is in both.

- Today's 373 clubs and the 32-county list are **all-island**. That matches how the sport is
  actually organised here: Golf Ireland governs all 32 counties, and a Portrush member and a
  Lahinch member hold the same membership.
- But "the UK, by country" means Northern Ireland has to appear as its own UK country, or
  the menu is wrong.

The two coherent answers:

**Option 1 — five countries: England, Ireland, Northern Ireland, Scotland, Wales.**
Ireland means the Republic. Matches the request exactly and matches how a UK golfer reads a
menu. Cost: it splits the island in a way Irish golf doesn't, and ~95 clubs move out of
"Ireland". Mitigated by a line and a cross-link on the Ireland page.

**Option 2 — four entries: England, Ireland (all 32), Scotland, Wales.**
Keeps the island together and keeps every existing profile correct. Cost: no "Northern
Ireland" in the dropdown, which is not what you asked for.

I lean to **Option 1** — you asked for UK-by-country, and a golfer in Belfast looking for
"Northern Ireland" and not finding it is the worse failure. But it's your call, and it is
much cheaper to decide now than after 3,000 rows are loaded.

## 4. What else moves when country arrives

The bit that isn't obvious from the request: **`COUNTIES` is not just a Courses thing.** It's
imported in ten places, and every one of them assumes 32 Irish counties:

| Where | What it does today |
|---|---|
| `/community` | "All counties" filter on the member directory |
| `/marketplace`, `/marketplace-preview` | Seller-location filter |
| `/marketplace/new`, `/marketplace/[id]/edit` | County on a listing |
| `/tee-times`, `/dashboard/availability/new` | County on a tee-time post |
| `/admin/listings`, `/admin/users` | Staff filters |
| `/profile/edit` | "County you play in most" |

Once members can be in Surrey or Fife, a bare county dropdown is wrong everywhere on that
list, not only on the profile. The clean fix is that **country and region always travel
together** — `country` + `region`, with the region list scoped to the selected country
(ceremonial counties for England, council areas for Scotland, principal areas for Wales, the
existing counties for Ireland/NI). Existing data migrates trivially: 6 profiles, 11 listings,
3 tee-time posts, all defaulting to Ireland.

Two knock-ons worth naming now, both out of scope but both real once UK members arrive:

- **Currency.** Listings are `price_eur` (there's a `currency` column, but the UI is euro).
  A Manchester seller pricing in euro is a problem the day they arrive.
- **Delivery.** Delivery options and collection notes assume domestic Ireland.

Neither blocks this work. Both should be on the list before you market to UK members.

## 5. The build, assuming the above is settled

**Data layer**
- New migration: rebuild `clubs` with `id, slug, name, country, region, town, website,
  latitude, longitude, holes, source, verified_at` + unique slug, indexed on
  `(country, region)` and a trigram index on name for search.
- Admin-only import route that pulls from the chosen source, normalises and dedupes, matches
  against the existing 373, and reports what it changed. Re-runnable.
- `profiles.home_club_id` → `clubs.id`, backfilled from the existing text, with `home_club`
  kept in place as the display value so nothing breaks mid-migration.

**Navigation**
- "Courses" becomes a dropdown: five countries + "All courses". Needs keyboard and
  touch handling, and the same list in `MobileNav` — the header deliberately renders one
  array twice so the two can't drift, and that property should survive.

**Pages**
- `/courses` — landing: five country cards with counts.
- `/courses/[country]` — server-rendered, searchable, region-filtered, A–Z. England alone is
  ~1,900 clubs, so this **cannot** be the current client-side approach; the whole list would
  ship to the browser in the JS bundle. Query the database, paginate.
- `/courses/[country]/[slug]` — the course page: name, region, town, **website link**
  (external, `rel="noopener nofollow"`), **location link** (Google/Apple Maps from the
  coordinates, plus a static map), and — the part that makes this Pinpals and not a
  directory — *members who play here*, *tee times posted at this course*, and a "set as my
  home club" button.

**Joining / profile**
- Country select → club combobox filtered to that country, on `/profile/edit` and on the
  tee-time post form.
- Country stored on the profile and shown as a chip on member cards; country filter added to
  `/community`, with the county filter scoped to the chosen country.

**Rough sequencing** — schema + import (the long pole, and the risky one), then nav and
country pages, then course detail pages, then profile/joining, then the community search
changes. Each as its own PR, in keeping with the repo's history.

---

## What I need from you

1. **Country taxonomy** — Option 1 (five countries, NI separate) or Option 2 (four, island
   of Ireland kept whole)?
2. **Data source** — OSM import now and correct by hand (free, live this week, patchy
   websites), or price a commercial dataset first (slower, cleaner)?
3. **Region/county** — convert county to country-scoped regions everywhere now, or leave
   marketplace and tee-times Ireland-only for the moment and only do Courses and profiles?
4. **Admin editing** — do you want a staff screen to fix a course's website, address and
   location by hand? Strongly recommended if we go with OSM; it's the thing that turns
   patchy data into good data over time.

Answer those four and I'll start with the schema and the import, which is where the risk is.
