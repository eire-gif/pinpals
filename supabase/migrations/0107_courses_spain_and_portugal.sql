-- Spain and Portugal join the course directory.
--
-- Irish members' most common golf trips are the Algarve, the Costa del Sol
-- and the Costa Blanca, so a tee time posted at Quinta do Lago or Valderrama
-- needs a club row to point at. The rows themselves come from the same
-- OpenStreetMap importer as the UK and Ireland (import-courses, now taking
-- `spain` and `portugal`) — this migration only widens the four country
-- checks that 0061 introduced so those rows, and the profiles, listings and
-- tee times that reference them, are allowed to exist.
--
-- Purely additive: every existing value stays valid.

alter table public.clubs drop constraint if exists clubs_country_check;
alter table public.clubs
  add constraint clubs_country_check
  check (country in ('ireland', 'northern-ireland', 'england', 'scotland', 'wales', 'spain', 'portugal'));

alter table public.profiles drop constraint if exists profiles_country_check;
alter table public.profiles
  add constraint profiles_country_check
  check (country is null or country in ('ireland', 'northern-ireland', 'england', 'scotland', 'wales', 'spain', 'portugal'));

alter table public.listings drop constraint if exists listings_country_check;
alter table public.listings
  add constraint listings_country_check
  check (country is null or country in ('ireland', 'northern-ireland', 'england', 'scotland', 'wales', 'spain', 'portugal'));

alter table public.tee_time_invites drop constraint if exists tee_time_invites_country_check;
alter table public.tee_time_invites
  add constraint tee_time_invites_country_check
  check (country is null or country in ('ireland', 'northern-ireland', 'england', 'scotland', 'wales', 'spain', 'portugal'));
