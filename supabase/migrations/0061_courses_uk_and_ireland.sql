-- Courses: from 373 Irish club names to a real course directory covering
-- Ireland, Northern Ireland, England, Scotland and Wales.
--
-- ============ What was here before ============
--
-- `clubs` (0001) was two columns — `id` and `name` — seeded with 373 Irish
-- club names in 0002. **Nothing in the application ever read it.** Every
-- club list in the UI came from `src/data/clubs.json`, a flat array of the
-- same 373 strings bundled into the browser. The table's only real job was
-- as the target of `profiles.home_club → clubs.name`, a foreign key on the
-- club's *name*.
--
-- That name-keyed FK is the first thing that has to go, and not for tidiness:
-- club names are unique across 373 Irish clubs but emphatically not across
-- ~3,000 in these five countries. There are several "Manor Golf Club"s, more
-- than one "Ashfield", and the `unique (name)` constraint behind that FK
-- would reject the second one on import. So this migration moves the
-- reference to the primary key.
--
-- `profiles.home_club` (text) stays exactly where it is, still holding the
-- club's display name. It is read in a dozen places — the community
-- directory, tee-time cards, marketplace seller cards, two admin screens —
-- and every one of those reads it straight off a `select("*")` on
-- `profiles` with no join. Dropping it here would mean rewriting all of
-- them in the same change that reshapes the schema. Instead `home_club_id`
-- is added alongside it as the real reference, `home_club` becomes an
-- unconstrained denormalised copy of `clubs.name`, and the reads migrate
-- one screen at a time afterwards.
--
-- ============ Country and region ============
--
-- `country` is a new column on `clubs`, `profiles`, `listings` and
-- `tee_time_invites`, constrained to five values. Northern Ireland is its
-- own country here rather than part of Ireland. That is a deliberate
-- product decision and it does cut against how the sport is organised —
-- Golf Ireland governs all 32 counties, and a Portrush member and a Lahinch
-- member hold the same membership — but "the UK, by country" is what the
-- Courses menu now offers, and a golfer in Belfast looking for Northern
-- Ireland and not finding it is the worse failure. The Ireland course page
-- cross-links to Northern Ireland to soften the split.
--
-- The existing `county` columns are NOT renamed. They now hold a region
-- name whose vocabulary depends on the country — Irish counties, English
-- ceremonial counties, Scottish council areas, Welsh principal areas — and
-- "region" would describe them better. But `county` appears in ten route
-- files and four export routes, all of which would have to change in
-- lockstep with the schema for a rename to be safe, and the column's
-- meaning ("the administrative area you're in") is unchanged. The
-- vocabulary lives in src/lib/regions.ts and is selected by country there.
--
-- ============ Backfill: why every seeded club is provisionally Ireland ============
--
-- The 373 seeded rows have names and nothing else — no county, no country,
-- no coordinates. Roughly 95 of them are in Northern Ireland (Ardglass,
-- Ardminnan, Aughnacloy and the rest), but nothing in the data says so, and
-- guessing from the name is not possible. They are therefore all set to
-- 'ireland' with `source = 'seed'`, and the OSM import corrects country and
-- region by name match on its first run. `source` is what tells the two
-- apart afterwards: a row still reading 'seed' has never been matched to a
-- real course record and its country should not be trusted.

-- ============ CLUBS ============

alter table public.clubs
  add column if not exists slug text,
  add column if not exists country text,
  add column if not exists region text,
  add column if not exists town text,
  add column if not exists website text,
  add column if not exists latitude double precision,
  add column if not exists longitude double precision,
  add column if not exists holes smallint,
  -- 'seed'   — one of the original 373 names, never matched to a real record
  -- 'osm'    — imported or corrected from OpenStreetMap
  -- 'manual' — created or edited by staff, and never overwritten by an import
  add column if not exists source text not null default 'seed',
  -- OSM's own type-prefixed identifier ("way/12345"), so a re-import updates
  -- the row it created last time instead of inserting a near-duplicate.
  add column if not exists osm_id text,
  -- Set when a staff member has checked this row by hand. The import treats
  -- a verified row's website, region and coordinates as authoritative and
  -- leaves them alone.
  add column if not exists verified_at timestamptz,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

update public.clubs
set country = 'ireland'
where country is null;

-- Slugs for the seeded rows: lowercase, non-alphanumerics collapsed to a
-- single hyphen, edges trimmed. Done in SQL rather than in the import so
-- that every row has a usable /courses URL the moment this migration lands,
-- before the import has ever run.
update public.clubs
set slug = trim(both '-' from regexp_replace(lower(name), '[^a-z0-9]+', '-', 'g'))
where slug is null;

-- Two clubs whose names differ only by punctuation would collapse to the
-- same slug. None do today, but the import will add ~2,600 more names, so
-- the constraint has to exist before it runs — a duplicate slug then fails
-- the insert loudly instead of silently overwriting another course's page.
alter table public.clubs
  alter column slug set not null,
  alter column country set not null;

alter table public.clubs drop constraint if exists clubs_country_check;
alter table public.clubs
  add constraint clubs_country_check
  check (country in ('ireland', 'northern-ireland', 'england', 'scotland', 'wales'));

alter table public.clubs drop constraint if exists clubs_source_check;
alter table public.clubs
  add constraint clubs_source_check
  check (source in ('seed', 'osm', 'manual'));

-- Coordinates are optional (a seeded row has none) but must be a real point
-- when present — a course silently plotted at 0°,0° in the Gulf of Guinea is
-- worse than one with no map link at all.
alter table public.clubs drop constraint if exists clubs_latitude_check;
alter table public.clubs drop constraint if exists clubs_longitude_check;
alter table public.clubs
  add constraint clubs_latitude_check
  check (latitude is null or (latitude between -90 and 90)),
  add constraint clubs_longitude_check
  check (longitude is null or (longitude between -180 and 180));

create unique index if not exists clubs_slug_key on public.clubs (slug);
create unique index if not exists clubs_osm_id_key on public.clubs (osm_id) where osm_id is not null;
create index if not exists clubs_country_region_idx on public.clubs (country, region);
create index if not exists clubs_country_name_idx on public.clubs (country, name);

-- Name search across ~3,000 rows. `ilike '%lahinch%'` cannot use a b-tree
-- index at all — the leading wildcard defeats it — and the club combobox
-- runs exactly that query on every keystroke.
-- pg_trgm is already installed on this project, in the `extensions` schema
-- (Supabase's convention — extensions never land in `public`). The operator
-- class is therefore schema-qualified: `gin_trgm_ops` unqualified resolves
-- only if `extensions` happens to be on the search_path of whoever runs the
-- migration, which is not something to depend on.
create extension if not exists pg_trgm with schema extensions;
create index if not exists clubs_name_trgm_idx on public.clubs using gin (name extensions.gin_trgm_ops);

drop trigger if exists clubs_set_updated_at on public.clubs;
create trigger clubs_set_updated_at
  before update on public.clubs
  for each row
  execute function public.set_updated_at();

-- ============ RLS: clubs ============
--
-- The public read policy from 0001 stays as it is — the course directory is
-- deliberately browsable logged-out, and it always was.
--
-- Writes are new. Staff edit courses through /admin/courses; the import
-- runs under the service-role key and bypasses RLS entirely, so it needs no
-- policy of its own.

drop policy if exists "staff can update clubs" on public.clubs;
create policy "staff can update clubs"
  on public.clubs for update
  to authenticated
  using (public.is_staff())
  with check (public.is_staff());

drop policy if exists "staff can insert clubs" on public.clubs;
create policy "staff can insert clubs"
  on public.clubs for insert
  to authenticated
  with check (public.is_staff());

-- Deliberately no delete policy. A course that closes should be marked, not
-- removed: members' `home_club_id` points at it, and deleting the row would
-- either cascade that away or fail. Nothing in the app deletes a club today.

-- ============ PROFILES ============

alter table public.profiles
  add column if not exists home_club_id bigint references public.clubs (id),
  add column if not exists country text;

update public.profiles p
set home_club_id = c.id
from public.clubs c
where p.home_club is not null
  and p.home_club_id is null
  and c.name = p.home_club;

-- Existing members are all Irish (the club list they chose from was), so
-- their country follows their club rather than being left blank and making
-- every one of them look incomplete in the directory.
update public.profiles p
set country = c.country
from public.clubs c
where p.country is null
  and p.home_club_id = c.id;

alter table public.profiles
  drop constraint if exists profiles_home_club_fkey;

alter table public.profiles drop constraint if exists profiles_country_check;
alter table public.profiles
  add constraint profiles_country_check
  check (country is null or country in ('ireland', 'northern-ireland', 'england', 'scotland', 'wales'));

create index if not exists profiles_country_idx on public.profiles (country);
create index if not exists profiles_home_club_id_idx on public.profiles (home_club_id);

-- ============ LISTINGS AND TEE TIMES ============
--
-- Both already carry a `county`; both now carry the country it belongs to.
-- Backfilled to Ireland because every existing row predates any other
-- country existing in the app.

alter table public.listings
  add column if not exists country text;

update public.listings set country = 'ireland' where country is null and county is not null;

alter table public.listings drop constraint if exists listings_country_check;
alter table public.listings
  add constraint listings_country_check
  check (country is null or country in ('ireland', 'northern-ireland', 'england', 'scotland', 'wales'));

create index if not exists listings_country_idx on public.listings (country);

alter table public.tee_time_invites
  add column if not exists country text,
  -- The club a tee time is at, as a real reference. `club_name` stays for
  -- the same reason `profiles.home_club` does: every card that renders a
  -- tee time reads it directly today.
  add column if not exists club_id bigint references public.clubs (id);

update public.tee_time_invites set country = 'ireland' where country is null;

update public.tee_time_invites t
set club_id = c.id
from public.clubs c
where t.club_id is null and c.name = t.club_name;

alter table public.tee_time_invites drop constraint if exists tee_time_invites_country_check;
alter table public.tee_time_invites
  add constraint tee_time_invites_country_check
  check (country is null or country in ('ireland', 'northern-ireland', 'england', 'scotland', 'wales'));

create index if not exists tee_time_invites_country_idx on public.tee_time_invites (country);
