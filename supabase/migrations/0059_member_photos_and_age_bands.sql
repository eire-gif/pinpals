-- Member profile photos, and date of birth surfaced only as an age band.
--
-- Two independent additions that ship together because both feed the same
-- redesigned Find Golfers tile (src/app/community/page.tsx):
--
--   1. profiles.avatar_url — an optional uploaded photo replacing the
--      initials circle wherever a member's avatar is drawn.
--   2. A date of birth, stored privately, exposed publicly only as a coarse
--      age band ("35–44"), and only when the member opts in.
--
-- ============ Why the date of birth is NOT a column on `profiles` ============
--
-- `profiles` is the member directory. Its SELECT policy (0001_init.sql) is
-- "readable by every signed-in member", and several call sites read it with
-- `select("*")` — src/app/community/page.tsx among them. A `date_of_birth`
-- column there would therefore be sent, in full, to every other member's
-- browser on every directory page load, no matter what the UI chose to
-- render. RLS is row-level: a policy cannot hide one column of a row it
-- allows. Postgres column privileges could, but revoking SELECT on a single
-- column breaks every existing `select("*")` against the table with
-- "permission denied", which is a far larger and more fragile change than
-- this feature warrants.
--
-- So the date itself lives in its own table, `member_birthdates`, readable
-- only by its owner (and staff), and the derived band is published through
-- `member_age_bands` — a view with the default SECURITY DEFINER semantics,
-- the same "deliberately narrower read surface over a table nobody else may
-- read" shape `auction_bid_history` (0045) and `seller_rating_summaries`
-- (0056) already use. The view exposes a user id and a band string and
-- nothing else: no date, no year, not even a row for a member who hasn't
-- opted in.
--
-- Consequence worth stating plainly: an age band is derived at read time,
-- so it moves on its own as a member ages. That is the point — nothing
-- needs re-computing or back-filling, and a stored band could never drift
-- out of date.
--
-- ============ Bands ============
--
-- Under 25 / 25–34 / 35–44 / 45–54 / 55–64 / 65+ — wide enough that a band
-- never identifies anyone in a directory this size, granular enough to be
-- useful when looking for a playing partner of roughly your own age.
-- Mirrored in TypeScript by ageBandForDate() (src/lib/age.ts) so the
-- member's own profile page can show them their band without a round trip;
-- this function is what's actually trusted for anything anyone else sees.
--
-- ============ Visibility ============
--
-- `age_range_visible` copies `handicap_visible` (0004) exactly, including
-- its `not null default false`: entering a date is not the same act as
-- publishing an age band, so opting in is explicit. A member who has set a
-- date but not the toggle simply produces no row in the view, and the tile
-- shows "Not shared".
--
-- ============ Not enforced here: a minimum age ============
--
-- No CHECK constraint restricts how young a stored date may be. Pinpals
-- takes payments and has a marketplace, so there is very likely a minimum
-- age in its Terms — but that is a policy this schema has never expressed
-- anywhere, and inventing one in a migration would either lock out junior
-- members who legitimately play, or silently imply a Terms position nobody
-- has agreed. Flagged for the owner rather than guessed at. If a minimum is
-- decided, it belongs at signup as well as here.
--
-- Rollback:
--   drop view if exists public.member_age_bands;
--   drop table if exists public.member_birthdates cascade;
--   alter table public.profiles drop column if exists avatar_url;
--   delete from storage.buckets where id = 'member-avatars';
--   -- plus the four storage policies named below.

-- ============ profiles.avatar_url ============
-- Nullable and unconstrained beyond a length cap: a null means "no photo,
-- draw the initials circle", which stays the fallback everywhere forever
-- (see MemberAvatar, src/components/member-avatar.tsx). Public by the same
-- policy that already makes the rest of the row public to signed-in
-- members, which is correct here — a profile photo is meant to be seen.
alter table public.profiles
  add column if not exists avatar_url text
  check (avatar_url is null or char_length(avatar_url) <= 500);

-- ============ member_birthdates ============
create table if not exists public.member_birthdates (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  date_of_birth date not null,
  -- Same not-null-default-false shape as profiles.handicap_visible (0004).
  age_range_visible boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.member_birthdates enable row level security;

drop trigger if exists member_birthdates_set_updated_at on public.member_birthdates;
create trigger member_birthdates_set_updated_at
  before update on public.member_birthdates
  for each row
  execute function public.set_updated_at();

-- Own row only. Deliberately NOT "readable by every signed-in member" the
-- way profiles is — that difference is the entire reason this table exists.
drop policy if exists "members view their own birthdate" on public.member_birthdates;
create policy "members view their own birthdate"
  on public.member_birthdates for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "staff view birthdates" on public.member_birthdates;
create policy "staff view birthdates"
  on public.member_birthdates for select
  to authenticated
  using (public.is_staff());

drop policy if exists "members set their own birthdate" on public.member_birthdates;
create policy "members set their own birthdate"
  on public.member_birthdates for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "members update their own birthdate" on public.member_birthdates;
create policy "members update their own birthdate"
  on public.member_birthdates for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "members delete their own birthdate" on public.member_birthdates;
create policy "members delete their own birthdate"
  on public.member_birthdates for delete
  to authenticated
  using ((select auth.uid()) = user_id);

revoke all on public.member_birthdates from anon;

-- ============ member_age_bands ============
-- The only surface any member other than the owner ever reads. A row exists
-- only when that member has both entered a date and switched the toggle on,
-- so "no row" and "not shared" are the same thing to every caller and no
-- caller has to re-implement the opt-in check.
--
-- Default view semantics (security_invoker off) — the view runs as its
-- owner, so it can read `member_birthdates` past that table's own-row-only
-- policy while exposing nothing but the band. Same shape as
-- auction_bid_history (0045).
create or replace view public.member_age_bands as
  select
    b.user_id,
    case
      when age(b.date_of_birth) < interval '25 years' then 'Under 25'
      when age(b.date_of_birth) < interval '35 years' then '25–34'
      when age(b.date_of_birth) < interval '45 years' then '35–44'
      when age(b.date_of_birth) < interval '55 years' then '45–54'
      when age(b.date_of_birth) < interval '65 years' then '55–64'
      else '65+'
    end as age_band
  from public.member_birthdates b
  where b.age_range_visible;

revoke all on public.member_age_bands from anon;
grant select on public.member_age_bands to authenticated;

-- ============ STORAGE: member avatars ============
-- Same shape as the 'listing-images' bucket (0003): public to read (an
-- <img> on a directory tile needs it), written only into a folder named
-- after the uploader's own user id. 2MB rather than 5MB — an avatar is
-- displayed at 64px, and the upload path downscales before sending.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('member-avatars', 'member-avatars', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

drop policy if exists "member avatars are publicly readable" on storage.objects;
create policy "member avatars are publicly readable"
  on storage.objects for select
  using (bucket_id = 'member-avatars');

drop policy if exists "users can upload their own avatar" on storage.objects;
create policy "users can upload their own avatar"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'member-avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "users can update their own avatar" on storage.objects;
create policy "users can update their own avatar"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'member-avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "users can delete their own avatar" on storage.objects;
create policy "users can delete their own avatar"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'member-avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
