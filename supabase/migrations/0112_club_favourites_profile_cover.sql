-- Favourite clubs and a profile cover photo (10 Oct 2026).
--
-- 1. FAVOURITE CLUBS. A star on any course in the directory; the Courses
--    screen gets a Favourites tab. Private: only the member reads their own
--    list (it says where they play, which is theirs to share via their home
--    club, not ours). One row per (member, club).
--
-- 2. PROFILE COVER. profiles.cover_url — a photograph across the top of a
--    member's profile, like the tee-time screens. Written only by the
--    website's /api/app/profile/cover route, which re-encodes it with sharp
--    (no EXIF, so no GPS) into the member's own folder of member-avatars,
--    the same public bucket and rules as the avatar. Null = the default
--    course photograph. Readable like the rest of the profile row.
--
-- Written without DROP so the Supabase tool applies it (it refuses any
-- batch containing one); IF NOT EXISTS blocks keep it re-runnable.
--
-- Rollback:
--   drop table if exists public.club_favourites;
--   alter table public.profiles drop column if exists cover_url;

alter table public.profiles
  add column if not exists cover_url text
  check (cover_url is null or char_length(cover_url) <= 500);

create table if not exists public.club_favourites (
  member_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  club_id bigint not null references public.clubs (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (member_id, club_id)
);

create index if not exists club_favourites_member_idx on public.club_favourites (member_id, created_at desc);

alter table public.club_favourites enable row level security;
revoke all on public.club_favourites from anon;
revoke update, truncate, references, trigger on public.club_favourites from authenticated;
grant select, insert, delete on public.club_favourites to authenticated;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'club_favourites' and policyname = 'members read their own favourite clubs') then
    create policy "members read their own favourite clubs"
      on public.club_favourites for select to authenticated
      using (member_id = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'club_favourites' and policyname = 'members add their own favourite clubs') then
    create policy "members add their own favourite clubs"
      on public.club_favourites for insert to authenticated
      with check (member_id = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'club_favourites' and policyname = 'members remove their own favourite clubs') then
    create policy "members remove their own favourite clubs"
      on public.club_favourites for delete to authenticated
      using (member_id = (select auth.uid()));
  end if;
end $$;
