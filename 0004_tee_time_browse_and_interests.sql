-- Pinpals: Tee-time browse filters + "I'm interested" requests

-- ============ TEE_TIME_INVITES: county for filtering ============
alter table public.tee_time_invites
  add column if not exists county text;

create index if not exists tee_time_invites_county_idx on public.tee_time_invites (county);
create index if not exists tee_time_invites_play_date_idx on public.tee_time_invites (play_date);

-- ============ PROFILES: opt-in handicap visibility ============
-- Off by default — a member's handicap only ever shows on their tee-time
-- invite cards if they explicitly turn this on in their profile.
alter table public.profiles
  add column if not exists handicap_visible boolean not null default false;

-- ============ TEE_TIME_INTERESTS ============
-- One row per "I'm interested" click. Never exposes contact details —
-- the interested member and the invite's host see each other's public
-- profile fields only (same as the rest of the app), never auth.users data.
create table if not exists public.tee_time_interests (
  id bigint generated always as identity primary key,
  invite_id bigint not null references public.tee_time_invites (id) on delete cascade,
  member_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (invite_id, member_id)
);

alter table public.tee_time_interests enable row level security;

drop trigger if exists tee_time_interests_set_updated_at on public.tee_time_interests;
create trigger tee_time_interests_set_updated_at
  before update on public.tee_time_interests
  for each row
  execute function public.set_updated_at();

-- A signed-in member can express interest in someone else's open invite,
-- only under their own member_id (can't post interest as anyone else, and
-- can't express interest in their own invite).
create policy "Members can express interest"
  on public.tee_time_interests for insert
  to authenticated
  with check (
    member_id = auth.uid()
    and exists (
      select 1 from public.tee_time_invites ti
      where ti.id = tee_time_interests.invite_id
        and ti.member_id <> auth.uid()
        and ti.status = 'open'
    )
  );

-- The interested member sees their own requests; the invite's host sees
-- every request made on invites they posted. Nobody else — including other
-- interested golfers — can see who else is interested.
create policy "See own interest or interest on your invites"
  on public.tee_time_interests for select
  to authenticated
  using (
    member_id = auth.uid()
    or exists (
      select 1 from public.tee_time_invites ti
      where ti.id = tee_time_interests.invite_id
        and ti.member_id = auth.uid()
    )
  );

-- Only the invite's host can accept or decline a request.
create policy "Hosts respond to interest"
  on public.tee_time_interests for update
  to authenticated
  using (
    exists (
      select 1 from public.tee_time_invites ti
      where ti.id = tee_time_interests.invite_id
        and ti.member_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.tee_time_invites ti
      where ti.id = tee_time_interests.invite_id
        and ti.member_id = auth.uid()
    )
  );

-- A member can withdraw their own interest.
create policy "Members withdraw their own interest"
  on public.tee_time_interests for delete
  to authenticated
  using (member_id = auth.uid());

create index if not exists tee_time_interests_invite_idx on public.tee_time_interests (invite_id);
create index if not exists tee_time_interests_member_idx on public.tee_time_interests (member_id);
