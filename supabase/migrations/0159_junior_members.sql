-- Junior members: PinPals opens to golfers aged 13 and over (Oct 2026).
-- Design and the reasoning behind each rule: claude/junior-members.md.
--
-- Age bands, worked out from the date of birth on every check (never stored,
-- so nothing drifts and birthdays upgrade an account by themselves):
--
--   junior_pending  13–15, no parent has approved yet. Can sign in and see
--                   their own account; can't play, post or join anything.
--   junior          13–15 with an approved parent link (GDPR consent: the
--                   digital age of consent in Ireland is 16).
--   youth           16–17. Also anyone flagged "may be under 18" by staff or
--                   by the phone's app store, until staff resolve it.
--   adult           18+.
--   unknown         No date of birth yet — members who joined before this
--                   migration. Treated as adults (PinPals was 18+ until now);
--                   the app and website ask them for a date of birth.
--
-- What each band may do (the full table is in the design doc):
--   under 18   no tee times, no Social (posts, comments, likes, reviews),
--              no chat, marketplace browse only, no creating groups, no
--              officer roles; their profile is visible only to people they
--              play with, their PinPals, their parent and approved contacts
--   13–15      also: no PinPals (connections) — the parent approves
--              contacts instead; they join only groups their parent is in;
--              PinPals they play with must be their parent, an approved
--              contact or someone in a group with them; surname shown as an
--              initial
--   pending    nothing that involves anyone else, and no live rounds
--
-- How it's enforced: BEFORE triggers on every table a restricted action
-- writes to. A trigger runs whoever writes the row — the member through
-- PostgREST, or one of the many SECURITY DEFINER functions (join a group,
-- invite to a tee time, create a group conversation…) that bypass RLS — so
-- one guard covers every path, present and future. Service-role writes
-- (auth.uid() is null) are the website's own server code and are trusted.
-- Reads: a restrictive policy hides minors' profiles from strangers, and
-- another keeps Social empty for under-18s.
--
-- The date of birth is entered once (at sign-up, or once by an existing
-- member) and then locked: only staff can change it. A junior can't delete
-- it to become "unknown".
--
-- Rollback (in order):
--   drop trigger on_auth_user_created_age on auth.users;
--   drop trigger on_auth_user_age_stash on auth.users;
--   drop every *_age_guard trigger listed in section 7 and the two policies
--   in section 8; drop function public.member_suggestions(integer) and
--   alter function public.member_suggestions_all(integer) rename to
--   member_suggestions; the same for ads_for_me / ads_for_me_all and
--   live_can_add_player / live_can_add_player_all;
--   drop the tables member_store_age_signals, member_age_flags,
--   junior_contacts, guardian_links, age_settings; alter
--   member_birthdates drop the generated columns and last_band; restore the
--   delete policy from 0059; alter member_private drop legal_last_name;
--   restore reports_category_check from 0055; drop the functions created here.

-- ===========================================================================
-- 1. Dates of birth: locked once set, 13 minimum, band boundaries stored
-- ===========================================================================

alter table public.member_birthdates
  add column if not exists sixteen_on date generated always as ((date_of_birth + interval '16 years')::date) stored,
  add column if not exists adult_on date generated always as ((date_of_birth + interval '18 years')::date) stored,
  -- The band the member was last told about, so a birthday that moves them
  -- up a band sends one "you're 16 now" alert (my_age_access()).
  add column if not exists last_band text;

-- A junior must not be able to remove their date of birth and become
-- "unknown". Deleting the account still removes it (cascade from profiles).
drop policy if exists "members delete their own birthdate" on public.member_birthdates;

create or replace function public.member_birthdates_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := (select auth.uid());
  v_trusted boolean := v_actor is null or public.is_staff();
begin
  if new.date_of_birth > current_date then
    raise exception 'That date of birth is in the future.' using errcode = '22023';
  end if;
  if new.date_of_birth < date '1900-01-01' then
    raise exception 'Please check that date of birth.' using errcode = '22023';
  end if;
  if tg_op = 'INSERT' and not v_trusted
     and new.date_of_birth > (current_date - interval '13 years')::date then
    raise exception 'You need to be 13 or over to join PinPals.' using errcode = '22023';
  end if;
  if tg_op = 'UPDATE' and new.date_of_birth is distinct from old.date_of_birth and not v_trusted then
    raise exception 'Your date of birth can''t be changed. Contact us if it''s wrong.' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.member_birthdates_guard() from public, anon, authenticated;

drop trigger if exists member_birthdates_guard on public.member_birthdates;
create trigger member_birthdates_guard
  before insert or update on public.member_birthdates
  for each row execute function public.member_birthdates_guard();

-- ===========================================================================
-- 2. Tables
-- ===========================================================================

-- One row. Whether a parent must also pass a €0 card check before a link is
-- approved. Off by default: the parent's own PinPals account (18+) and
-- email are the baseline "reasonable effort"; the card check adds to it.
create table if not exists public.age_settings (
  id boolean primary key default true check (id),
  require_parent_card_check boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null
);
insert into public.age_settings (id) values (true) on conflict (id) do nothing;

alter table public.age_settings enable row level security;
drop policy if exists "anyone signed in reads age settings" on public.age_settings;
create policy "anyone signed in reads age settings" on public.age_settings
  for select to authenticated using (true);
drop policy if exists "staff change age settings" on public.age_settings;
create policy "staff change age settings" on public.age_settings
  for update to authenticated using (public.is_staff(array['admin'])) with check (public.is_staff(array['admin']));
revoke all on public.age_settings from anon, authenticated;
grant select, update on public.age_settings to authenticated;

-- A 13–15 year old's link to a parent. Written only by the functions below
-- (and the sign-up trigger). The link token is never stored, only its
-- SHA-256 (computed by the website, as for live follows in 0158).
create table if not exists public.guardian_links (
  id bigint generated always as identity primary key,
  junior_id uuid not null references public.profiles (id) on delete cascade,
  guardian_email text not null check (char_length(guardian_email) between 3 and 320),
  guardian_id uuid references public.profiles (id) on delete set null,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined', 'revoked')),
  invited_at timestamptz not null default now(),
  consented_at timestamptz,
  approved_at timestamptz,
  card_checked_at timestamptz,
  ended_at timestamptz
);

-- One live link (pending or approved) per junior.
create unique index if not exists guardian_links_one_live
  on public.guardian_links (junior_id) where status in ('pending', 'approved');
create index if not exists guardian_links_guardian_idx
  on public.guardian_links (guardian_id) where guardian_id is not null;

alter table public.guardian_links enable row level security;
drop policy if exists "junior and parent see their link" on public.guardian_links;
create policy "junior and parent see their link" on public.guardian_links
  for select to authenticated
  using (junior_id = (select auth.uid()) or guardian_id = (select auth.uid()) or public.is_staff());
revoke all on public.guardian_links from anon, authenticated;
grant select on public.guardian_links to authenticated;

-- PinPals a parent has approved for their 13–15 year old to play with.
create table if not exists public.junior_contacts (
  junior_id uuid not null references public.profiles (id) on delete cascade,
  contact_id uuid not null references public.profiles (id) on delete cascade,
  approved_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (junior_id, contact_id),
  check (junior_id <> contact_id)
);
create index if not exists junior_contacts_contact_idx on public.junior_contacts (contact_id);

alter table public.junior_contacts enable row level security;
drop policy if exists "junior and parent see contacts" on public.junior_contacts;
create policy "junior and parent see contacts" on public.junior_contacts
  for select to authenticated
  using (
    junior_id = (select auth.uid())
    or exists (select 1 from public.guardian_links g
                where g.junior_id = junior_contacts.junior_id and g.guardian_id = (select auth.uid())
                  and g.status = 'approved')
    or public.is_staff()
  );
revoke all on public.junior_contacts from anon, authenticated;
grant select on public.junior_contacts to authenticated;

-- "This member may be under 18." Raised by staff (after an underage report)
-- or by the app store's age signal. While unresolved the member is treated
-- as 16–17. Staff only.
create table if not exists public.member_age_flags (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  reason text not null check (reason in ('report', 'store_signal', 'staff')),
  note text check (note is null or char_length(note) <= 1000),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles (id) on delete set null
);
alter table public.member_age_flags enable row level security;
drop policy if exists "staff see age flags" on public.member_age_flags;
create policy "staff see age flags" on public.member_age_flags
  for select to authenticated using (public.is_staff());
revoke all on public.member_age_flags from anon, authenticated;
grant select on public.member_age_flags to authenticated;

-- What the phone's app store last said about the member's age (Apple's
-- Declared Age Range, Google Play Age Signals). Kept for staff review.
create table if not exists public.member_store_age_signals (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  platform text not null check (platform in ('ios', 'android')),
  age_lower smallint check (age_lower is null or age_lower between 0 and 120),
  age_upper smallint check (age_upper is null or age_upper between 0 and 120),
  status text check (status is null or char_length(status) <= 40),
  received_at timestamptz not null default now()
);
alter table public.member_store_age_signals enable row level security;
drop policy if exists "staff see store age signals" on public.member_store_age_signals;
create policy "staff see store age signals" on public.member_store_age_signals
  for select to authenticated using (public.is_staff());
revoke all on public.member_store_age_signals from anon, authenticated;
grant select on public.member_store_age_signals to authenticated;

-- A 13–15 year old's real surname, while the profile shows an initial.
alter table public.member_private
  add column if not exists legal_last_name text
  check (legal_last_name is null or char_length(legal_last_name) between 1 and 80);

-- "May be under 18" as a report category.
alter table public.reports drop constraint if exists reports_category_check;
alter table public.reports add constraint reports_category_check
  check (
    category in (
      'spam', 'harassment', 'inappropriate_content', 'scam_fraud', 'fake_listing', 'no_show', 'other',
      'item_not_as_described', 'item_not_received', 'payment_issue', 'underage'
    )
  );

-- ===========================================================================
-- 3. The band, and who may see or play with a minor
-- ===========================================================================

create or replace function public.age_band_of(p_user uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_user is null then 'unknown'
    when b.user_id is null then case when f.user_id is not null then 'youth' else 'unknown' end
    when current_date < b.sixteen_on then
      case when exists (select 1 from public.guardian_links g
                         where g.junior_id = p_user and g.status = 'approved')
           then 'junior' else 'junior_pending' end
    when current_date < b.adult_on then 'youth'
    when f.user_id is not null then 'youth'
    else 'adult'
  end
  from (select p_user as u) x
  left join public.member_birthdates b on b.user_id = x.u
  left join public.member_age_flags f on f.user_id = x.u and f.resolved_at is null;
$$;

-- Cheap "is this member under 18 (or flagged)?" for policies run per row.
create or replace function public.is_minor(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.member_birthdates b where b.user_id = p_user and current_date < b.adult_on)
      or exists (select 1 from public.member_age_flags f where f.user_id = p_user and f.resolved_at is null);
$$;

create or replace function public.is_under_16(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.member_birthdates b where b.user_id = p_user and current_date < b.sixteen_on);
$$;

-- The approved parent of a junior, if any.
create or replace function public.guardian_of(p_junior uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select g.guardian_id from public.guardian_links g
   where g.junior_id = p_junior and g.status = 'approved'
   limit 1;
$$;

-- May p_other play with (be put in a round with) the 13–15 year old p_junior?
-- Their parent, an approved contact, or someone in a group with them (a
-- junior is only ever in groups their parent is in).
create or replace function public.junior_may_play_with(p_junior uuid, p_other uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_other = p_junior
      or p_other = public.guardian_of(p_junior)
      or exists (select 1 from public.junior_contacts c where c.junior_id = p_junior and c.contact_id = p_other)
      or exists (select 1 from public.group_members a
                   join public.group_members b on b.group_id = a.group_id
                  where a.member_id = p_junior and b.member_id = p_other);
$$;

-- May the signed-in viewer see the minor p_minor's profile?
create or replace function public.can_see_minor(p_minor uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with me as (select (select auth.uid()) as id)
  select (select id from me) is not null and (
       (select id from me) = p_minor
    or public.is_staff()
    or exists (select 1 from public.guardian_links g
                where g.junior_id = p_minor and g.guardian_id = (select id from me) and g.status in ('pending', 'approved'))
    or exists (select 1 from public.junior_contacts c where c.junior_id = p_minor and c.contact_id = (select id from me))
    or exists (select 1 from public.connections c
                where c.status = 'accepted'
                  and ((c.requester_id = p_minor and c.recipient_id = (select id from me))
                    or (c.recipient_id = p_minor and c.requester_id = (select id from me))))
    or exists (select 1 from public.group_members a
                 join public.group_members b on b.group_id = a.group_id
                where a.member_id = p_minor and b.member_id = (select id from me))
    or exists (select 1 from public.live_round_players a
                 join public.live_round_players b on b.round_id = a.round_id
                where a.member_id = p_minor and b.member_id = (select id from me))
    or exists (select 1 from public.live_rounds r
                 join public.live_round_players a on a.round_id = r.id
                where a.member_id = p_minor and r.created_by = (select id from me))
  );
$$;

-- The profiles policy in section 8, in one call so is_minor() itself never
-- has to be executable by members: it answers "may I see this row", which
-- the row's presence answers anyway.
create or replace function public.profile_visible_to_me(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_id = (select auth.uid()) or not public.is_minor(p_id) or public.can_see_minor(p_id);
$$;

create or replace function public.my_is_minor()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_minor((select auth.uid()));
$$;

revoke all on function public.age_band_of(uuid) from public, anon, authenticated;
revoke all on function public.is_minor(uuid) from public, anon, authenticated;
revoke all on function public.is_under_16(uuid) from public, anon, authenticated;
revoke all on function public.guardian_of(uuid) from public, anon, authenticated;
revoke all on function public.junior_may_play_with(uuid, uuid) from public, anon, authenticated;
-- Used inside RLS policies evaluated as `authenticated`, so they must stay
-- executable by it. Neither reveals anything beyond "can I see this row".
revoke all on function public.can_see_minor(uuid) from public, anon;
grant execute on function public.can_see_minor(uuid) to authenticated;
revoke all on function public.profile_visible_to_me(uuid) from public, anon;
grant execute on function public.profile_visible_to_me(uuid) to authenticated;
revoke all on function public.my_is_minor() from public, anon;
grant execute on function public.my_is_minor() to authenticated;

-- ===========================================================================
-- 4. Under-16 surname shown as an initial
-- ===========================================================================

create or replace function public.mask_junior_surname()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := btrim(coalesce(new.last_name, ''));
begin
  if public.is_under_16(new.id) and v_name !~ '^.\.$' and v_name <> '' then
    -- Same flag 0133's profiles trigger uses, so member_private's sync
    -- trigger doesn't write back to the profiles row being written here.
    perform set_config('pinpals.from_profiles', 'on', true);
    insert into public.member_private (member_id, legal_last_name)
    values (new.id, left(v_name, 80))
    on conflict (member_id) do update set legal_last_name = excluded.legal_last_name, updated_at = now();
    perform set_config('pinpals.from_profiles', 'off', true);
    new.last_name := upper(left(v_name, 1)) || '.';
  end if;
  return new;
end;
$$;

revoke all on function public.mask_junior_surname() from public, anon, authenticated;

drop trigger if exists profiles_mask_junior_surname on public.profiles;
create trigger profiles_mask_junior_surname
  before insert or update of last_name on public.profiles
  for each row execute function public.mask_junior_surname();

-- When a date of birth arrives (sign-up, or entered later), apply the mask.
create or replace function public.member_birthdates_after()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_under_16(new.user_id) then
    update public.profiles set last_name = last_name where id = new.user_id;
  end if;
  return null;
end;
$$;

revoke all on function public.member_birthdates_after() from public, anon, authenticated;

drop trigger if exists member_birthdates_after on public.member_birthdates;
create trigger member_birthdates_after
  after insert or update of date_of_birth on public.member_birthdates
  for each row execute function public.member_birthdates_after();

-- ===========================================================================
-- 5. Sign-up: date of birth and parent's email from the sign-up form
-- ===========================================================================
--
-- src/lib/signup.ts validates and passes date_of_birth (and, for 13–15,
-- guardian_email + guardian_token_hash) in the sign-up metadata. Done here,
-- in the same transaction that creates the account, so no account can exist
-- without the date it was created with. The keys are then removed from
-- auth.users before the row is written, so the date of birth isn't kept
-- there as well.
-- Named to run after 0001's on_auth_user_created (which makes the profile).

-- BEFORE INSERT: take our three keys out of the metadata (so they're never
-- stored in auth.users) and hold them for the AFTER trigger in a
-- transaction-local setting.
create or replace function public.member_age_signup_stash()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
begin
  perform set_config('pinpals.signup_age',
    jsonb_build_object(
      'id', new.id,
      'date_of_birth', v_meta -> 'date_of_birth',
      'guardian_email', v_meta -> 'guardian_email',
      'guardian_token_hash', v_meta -> 'guardian_token_hash'
    )::text, true);
  new.raw_user_meta_data := v_meta - 'date_of_birth' - 'guardian_email' - 'guardian_token_hash';
  return new;
end;
$$;

-- AFTER INSERT (after 0001's on_auth_user_created has made the profile).
create or replace function public.member_age_from_signup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_stash jsonb := nullif(current_setting('pinpals.signup_age', true), '')::jsonb;
  v_dob date;
  v_email text;
  v_hash text;
begin
  perform set_config('pinpals.signup_age', '', true);
  if v_stash is null or (v_stash ->> 'id')::uuid is distinct from new.id
     or (v_stash ->> 'date_of_birth') is null then
    return null;
  end if;
  begin
    v_dob := (v_stash ->> 'date_of_birth')::date;
  exception when others then
    raise exception 'Please check your date of birth.' using errcode = '22023';
  end;
  -- The website checks this first; this catches a sign-up sent straight to
  -- Supabase Auth with the public key, past the website.
  if v_dob > (current_date - interval '13 years')::date then
    raise exception 'You need to be 13 or over to join PinPals.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles where id = new.id) then
    return null;
  end if;

  insert into public.member_birthdates (user_id, date_of_birth) values (new.id, v_dob)
  on conflict (user_id) do nothing;

  if public.is_under_16(new.id) then
    v_email := lower(btrim(coalesce(v_stash ->> 'guardian_email', '')));
    v_hash := lower(btrim(coalesce(v_stash ->> 'guardian_token_hash', '')));
    if v_email = '' or v_hash !~ '^[0-9a-f]{64}$' then
      raise exception 'A parent or guardian''s email is needed for members under 16.' using errcode = '22023';
    end if;
    insert into public.guardian_links (junior_id, guardian_email, token_hash)
    values (new.id, v_email, v_hash);
  end if;
  return null;
end;
$$;

revoke all on function public.member_age_signup_stash() from public, anon, authenticated;
revoke all on function public.member_age_from_signup() from public, anon, authenticated;

drop trigger if exists on_auth_user_age_stash on auth.users;
create trigger on_auth_user_age_stash
  before insert on auth.users
  for each row execute function public.member_age_signup_stash();

drop trigger if exists on_auth_user_created_age on auth.users;
create trigger on_auth_user_created_age
  after insert on auth.users
  for each row execute function public.member_age_from_signup();

-- ===========================================================================
-- 6. Functions the app and website call
-- ===========================================================================

-- Everything a screen needs to decide what to show. Also does the two jobs
-- that fall due on a birthday: restoring a surname at 16, and one alert when
-- the band moves up. The rules here are the ones the triggers in section 7
-- enforce; keep them in step.
create or replace function public.my_age_access()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_band text;
  v_dob date;
  v_last text;
  v_link public.guardian_links%rowtype;
  v_flagged boolean;
  v_minor boolean;
  v_title text;
  v_body text;
begin
  if v_me is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;

  v_band := public.age_band_of(v_me);
  select date_of_birth, last_band into v_dob, v_last from public.member_birthdates where user_id = v_me;
  v_flagged := exists (select 1 from public.member_age_flags where user_id = v_me and resolved_at is null);
  v_minor := v_band in ('junior', 'junior_pending', 'youth');

  -- 16th birthday: the full surname comes back.
  if v_band in ('youth', 'adult', 'unknown') then
    update public.profiles p
       set last_name = mp.legal_last_name
      from public.member_private mp
     where p.id = v_me and mp.member_id = v_me and mp.legal_last_name is not null
       and p.last_name ~ '^.\.$';
    update public.member_private set legal_last_name = null where member_id = v_me and legal_last_name is not null;
  end if;

  -- One alert when a birthday moves the member up.
  if v_dob is not null and v_last is distinct from v_band then
    if v_last in ('junior', 'junior_pending') and v_band = 'youth' and not v_flagged then
      v_title := 'You''re 16 — welcome to the next level';
      v_body := 'Your parent link is no longer needed. Tee times, Social and chat open up at 18.';
    elsif v_last in ('junior', 'junior_pending', 'youth') and v_band = 'adult' then
      v_title := 'Happy 18th — all of PinPals is open to you';
      v_body := 'Tee times, Social, chat and selling in the marketplace are now switched on.';
    elsif v_last = 'junior_pending' and v_band = 'junior' then
      v_title := 'Your parent said yes';
      v_body := 'Live scoring and sharing your rounds are switched on.';
    end if;
    if v_title is not null then
      perform public.notify_user(v_me, 'age_band_changed', v_title, v_body,
                                 jsonb_build_object('band', v_band), 'age_band:' || v_band);
    end if;
    update public.member_birthdates set last_band = v_band where user_id = v_me;
  end if;

  select * into v_link from public.guardian_links
   where junior_id = v_me order by (status in ('pending', 'approved')) desc, invited_at desc limit 1;

  return jsonb_build_object(
    'band', v_band,
    'age', case when v_dob is null then null else extract(year from age(v_dob))::int end,
    'dateOfBirth', v_dob,
    'needsDateOfBirth', v_dob is null,
    'underReview', v_flagged,
    'parent', case when v_link.id is null or v_band not in ('junior', 'junior_pending') then null else jsonb_build_object(
      'status', v_link.status,
      'email', v_link.guardian_email,
      'invitedAt', v_link.invited_at,
      'approvedAt', v_link.approved_at,
      'consentedAt', v_link.consented_at
    ) end,
    'can', jsonb_build_object(
      'liveScoring', v_band <> 'junior_pending',
      'shareLive', v_band <> 'junior_pending',
      'teeTimes', not v_minor,
      'social', not v_minor,
      'chat', not v_minor,
      'marketplace', case when v_minor then 'browse' else 'full' end,
      'createGroups', not v_minor,
      'groupOfficer', not v_minor,
      'joinGroups', case v_band when 'junior_pending' then 'none' when 'junior' then 'parent' else 'all' end,
      'connections', v_band not in ('junior', 'junior_pending'),
      'playWith', case v_band when 'junior_pending' then 'none' when 'junior' then 'approved' else 'all' end,
      'personalisedAds', not v_minor
    )
  );
end;
$$;

revoke all on function public.my_age_access() from public, anon;
grant execute on function public.my_age_access() to authenticated;

-- An existing member enters their date of birth (once). The 13 minimum and
-- the lock are the table's trigger. A 13–15 year old entering it here also
-- needs a parent: the app then asks for the parent's email
-- (POST /api/app/age/parent).
create or replace function public.set_my_date_of_birth(p_date date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
begin
  if v_me is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  if p_date is null then
    raise exception 'Please enter your date of birth.' using errcode = '22023';
  end if;
  if exists (select 1 from public.member_birthdates where user_id = v_me) then
    raise exception 'Your date of birth can''t be changed. Contact us if it''s wrong.' using errcode = '42501';
  end if;
  -- An account can't enter a date that makes it under 13: the guard trigger
  -- says so. Existing (pre-junior) accounts are the only callers.
  insert into public.member_birthdates (user_id, date_of_birth) values (v_me, p_date);
  return public.my_age_access();
end;
$$;

revoke all on function public.set_my_date_of_birth(date) from public, anon;
grant execute on function public.set_my_date_of_birth(date) to authenticated;

-- The parent's page, before they sign in: whose request is this? First name
-- only — nothing else about the child leaves the database here.
create or replace function public.guardian_link_preview(p_token_hash text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case when g.id is null then null else jsonb_build_object(
    'status', case when g.status = 'pending' and g.invited_at < now() - interval '30 days' then 'expired' else g.status end,
    'childFirstName', p.first_name,
    'invitedAt', g.invited_at,
    'awaitingCardCheck', g.status = 'pending' and g.consented_at is not null,
    'cardCheckRequired', (select s.require_parent_card_check from public.age_settings s where s.id)
  ) end
  from (select lower(p_token_hash) as h) x
  left join public.guardian_links g on g.token_hash = x.h
  left join public.profiles p on p.id = g.junior_id;
$$;

revoke all on function public.guardian_link_preview(text) from public;
grant execute on function public.guardian_link_preview(text) to anon, authenticated;

-- The parent says yes, signed in to their own PinPals account. They must be
-- 18+ by their own date of birth. With the card check switched on, the link
-- waits for it (guardian_link_card_checked, called by the website after
-- Stripe confirms); otherwise it's approved now.
create or replace function public.guardian_link_accept(p_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_link public.guardian_links%rowtype;
  v_band text;
  v_card boolean;
begin
  if v_me is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  select * into v_link from public.guardian_links where token_hash = lower(p_token_hash) for update;
  if not found then
    raise exception 'That link isn''t valid.' using errcode = 'P0002';
  end if;
  if v_link.status = 'approved' and v_link.guardian_id = v_me then
    return jsonb_build_object('status', 'approved', 'linkId', v_link.id);
  end if;
  if v_link.status <> 'pending' then
    raise exception 'That request has already been answered.' using errcode = '22023';
  end if;
  if v_link.invited_at < now() - interval '30 days' then
    raise exception 'That link has expired. Ask your child to send a new one from the app.' using errcode = '22023';
  end if;
  if v_link.guardian_id is not null and v_link.guardian_id <> v_me then
    raise exception 'Another account has already answered this request.' using errcode = '42501';
  end if;
  if v_me = v_link.junior_id then
    raise exception 'A parent or guardian needs to approve this from their own account.' using errcode = '42501';
  end if;
  v_band := public.age_band_of(v_me);
  if v_band = 'unknown' then
    raise exception 'needs_dob' using errcode = 'P0001',
      hint = 'Add your date of birth to your account first.';
  end if;
  if v_band <> 'adult' then
    raise exception 'A parent or guardian must be 18 or over.' using errcode = '42501';
  end if;

  select s.require_parent_card_check into v_card from public.age_settings s where s.id;

  update public.guardian_links
     set guardian_id = v_me,
         consented_at = coalesce(consented_at, now()),
         status = case when coalesce(v_card, false) then 'pending' else 'approved' end,
         approved_at = case when coalesce(v_card, false) then null else now() end
   where id = v_link.id;

  if not coalesce(v_card, false) then
    perform public.notify_user(v_link.junior_id, 'parent_link_approved', 'Your parent said yes',
                               'Live scoring and sharing your rounds are switched on.', '{}'::jsonb,
                               'parent_link:' || v_link.id);
  end if;

  return jsonb_build_object('status', case when coalesce(v_card, false) then 'card_check' else 'approved' end,
                            'linkId', v_link.id);
end;
$$;

revoke all on function public.guardian_link_accept(text) from public, anon;
grant execute on function public.guardian_link_accept(text) to authenticated;

-- Stripe has confirmed the parent's €0 card check. Website only.
create or replace function public.guardian_link_card_checked(p_link_id bigint, p_guardian uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_link public.guardian_links%rowtype;
begin
  select * into v_link from public.guardian_links where id = p_link_id for update;
  if not found or v_link.guardian_id is distinct from p_guardian or v_link.consented_at is null then
    return false;
  end if;
  if v_link.status = 'approved' then
    return true;
  end if;
  if v_link.status <> 'pending' then
    return false;
  end if;
  update public.guardian_links
     set status = 'approved', approved_at = now(), card_checked_at = now()
   where id = p_link_id;
  perform public.notify_user(v_link.junior_id, 'parent_link_approved', 'Your parent said yes',
                             'Live scoring and sharing your rounds are switched on.', '{}'::jsonb,
                             'parent_link:' || v_link.id);
  return true;
end;
$$;

revoke all on function public.guardian_link_card_checked(bigint, uuid) from public, anon, authenticated;
grant execute on function public.guardian_link_card_checked(bigint, uuid) to service_role;

create or replace function public.guardian_link_decline(p_token_hash text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.guardian_links
     set status = 'declined', ended_at = now()
   where token_hash = lower(p_token_hash) and status = 'pending';
  if not found then
    raise exception 'That request has already been answered.' using errcode = '22023';
  end if;
end;
$$;

revoke all on function public.guardian_link_decline(text) from public;
grant execute on function public.guardian_link_decline(text) to anon, authenticated;

-- The parent withdraws consent. The junior goes back to waiting for a parent.
create or replace function public.guardian_link_revoke(p_link_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
begin
  update public.guardian_links
     set status = 'revoked', ended_at = now()
   where id = p_link_id and status in ('pending', 'approved')
     and (guardian_id = v_me or public.is_staff(array['admin', 'moderator']));
  if not found then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
end;
$$;

revoke all on function public.guardian_link_revoke(bigint) from public, anon;
grant execute on function public.guardian_link_revoke(bigint) to authenticated;

-- A junior's new parent request (wrong email, or after a decline). Website
-- only — it creates the token and sends the email (POST /api/app/age/parent).
create or replace function public.guardian_link_reissue(p_junior uuid, p_email text, p_token_hash text)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id bigint;
begin
  if not public.is_under_16(p_junior) then
    raise exception 'Only members under 16 need a parent link.' using errcode = '22023';
  end if;
  if exists (select 1 from public.guardian_links where junior_id = p_junior and status = 'approved') then
    raise exception 'Your parent has already approved your account.' using errcode = '22023';
  end if;
  update public.guardian_links set status = 'revoked', ended_at = now()
   where junior_id = p_junior and status = 'pending';
  insert into public.guardian_links (junior_id, guardian_email, token_hash)
  values (p_junior, lower(btrim(p_email)), lower(p_token_hash))
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.guardian_link_reissue(uuid, text, text) from public, anon, authenticated;
grant execute on function public.guardian_link_reissue(uuid, text, text) to service_role;

-- The parent's dashboard: their children.
create or replace function public.my_children()
returns table (
  link_id bigint,
  junior_id uuid,
  first_name text,
  last_name text,
  avatar_url text,
  age int,
  status text,
  consented_at timestamptz,
  approved_at timestamptz,
  card_checked_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select g.id, g.junior_id, p.first_name, coalesce(mp.legal_last_name, p.last_name), p.avatar_url,
         extract(year from age(b.date_of_birth))::int, g.status, g.consented_at, g.approved_at, g.card_checked_at
    from public.guardian_links g
    join public.profiles p on p.id = g.junior_id
    left join public.member_private mp on mp.member_id = g.junior_id
    left join public.member_birthdates b on b.user_id = g.junior_id
   where g.guardian_id = (select auth.uid())
     and g.status in ('pending', 'approved')
     and public.is_under_16(g.junior_id)
   order by p.first_name;
$$;

revoke all on function public.my_children() from public, anon;
grant execute on function public.my_children() to authenticated;

-- Approve (or remove) a PinPal for a child to play with. The parent picks
-- from their own PinPals.
create or replace function public.junior_contact_set(p_junior uuid, p_contact uuid, p_on boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
begin
  if v_me is null or public.guardian_of(p_junior) is distinct from v_me then
    raise exception 'Only the parent can change this.' using errcode = '42501';
  end if;
  if p_on then
    if p_contact = p_junior or p_contact = v_me then
      raise exception 'Choose someone else.' using errcode = '22023';
    end if;
    if not exists (select 1 from public.connections c
                    where c.status = 'accepted'
                      and ((c.requester_id = v_me and c.recipient_id = p_contact)
                        or (c.recipient_id = v_me and c.requester_id = p_contact))) then
      raise exception 'You can approve your own PinPals only.' using errcode = '42501';
    end if;
    insert into public.junior_contacts (junior_id, contact_id, approved_by)
    values (p_junior, p_contact, v_me)
    on conflict (junior_id, contact_id) do nothing;
  else
    delete from public.junior_contacts where junior_id = p_junior and contact_id = p_contact;
  end if;
end;
$$;

revoke all on function public.junior_contact_set(uuid, uuid, boolean) from public, anon;
grant execute on function public.junior_contact_set(uuid, uuid, boolean) to authenticated;

-- The contacts list, for the parent (to manage) or the junior (to invite).
create or replace function public.junior_contact_list(p_junior uuid)
returns table (contact_id uuid, first_name text, last_name text, avatar_url text, avatar_color text, approved boolean)
language sql
stable
security definer
set search_path = public
as $$
  with me as (select (select auth.uid()) as id),
  allowed as (
    select (select id from me) = p_junior or public.guardian_of(p_junior) = (select id from me) as ok,
           public.guardian_of(p_junior) = (select id from me) as is_parent
  ),
  pool as (
    -- Approved contacts…
    select c.contact_id as id, true as approved from public.junior_contacts c where c.junior_id = p_junior
    union
    -- …and, for the parent, their own PinPals to choose from.
    select case when k.requester_id = (select id from me) then k.recipient_id else k.requester_id end, false
      from public.connections k
     where (select is_parent from allowed)
       and k.status = 'accepted'
       and (k.requester_id = (select id from me) or k.recipient_id = (select id from me))
  )
  select p.id, p.first_name, p.last_name, p.avatar_url, p.avatar_color, bool_or(pool.approved)
    from pool
    join public.profiles p on p.id = pool.id
   where (select ok from allowed) and p.id <> p_junior and p.deleted_at is null
   group by p.id, p.first_name, p.last_name, p.avatar_url, p.avatar_color
   order by bool_or(pool.approved) desc, p.first_name;
$$;

revoke all on function public.junior_contact_list(uuid) from public, anon;
grant execute on function public.junior_contact_list(uuid) to authenticated;

-- The phone's app store said something about the member's age. An upper
-- bound under 18 on an account that says 18+ (or has no date) flags it for
-- review and restricts it to 16–17 until staff look.
create or replace function public.report_store_age_signal(p_platform text, p_lower int, p_upper int, p_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_band text;
begin
  if v_me is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  if p_platform not in ('ios', 'android') then
    raise exception 'Unknown platform' using errcode = '22023';
  end if;
  insert into public.member_store_age_signals (user_id, platform, age_lower, age_upper, status, received_at)
  values (v_me, p_platform, p_lower, p_upper, left(p_status, 40), now())
  on conflict (user_id) do update
    set platform = excluded.platform, age_lower = excluded.age_lower, age_upper = excluded.age_upper,
        status = excluded.status, received_at = excluded.received_at;

  v_band := public.age_band_of(v_me);
  if p_upper is not null and p_upper < 18 and v_band in ('adult', 'unknown') then
    insert into public.member_age_flags (user_id, reason, note)
    values (v_me, 'store_signal',
            format('%s app store says %s–%s', p_platform, coalesce(p_lower::text, '?'), p_upper))
    on conflict (user_id) do update
      set reason = excluded.reason, note = excluded.note, created_at = now(), resolved_at = null, resolved_by = null
      where public.member_age_flags.resolved_at is not null and public.member_age_flags.reason <> 'staff';
  end if;
end;
$$;

revoke all on function public.report_store_age_signal(text, int, int, text) from public, anon;
grant execute on function public.report_store_age_signal(text, int, int, text) to authenticated;

-- Staff: restrict (or clear) an account pending an age check.
create or replace function public.admin_set_age_flag(p_user uuid, p_on boolean, p_note text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
begin
  if not public.is_staff(array['admin', 'moderator', 'support']) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if p_on then
    insert into public.member_age_flags (user_id, reason, note, created_by)
    values (p_user, 'staff', left(p_note, 1000), v_me)
    on conflict (user_id) do update
      set reason = 'staff', note = excluded.note, created_by = v_me, created_at = now(),
          resolved_at = null, resolved_by = null;
  else
    update public.member_age_flags set resolved_at = now(), resolved_by = v_me
     where user_id = p_user and resolved_at is null;
  end if;
end;
$$;

revoke all on function public.admin_set_age_flag(uuid, boolean, text) from public, anon;
grant execute on function public.admin_set_age_flag(uuid, boolean, text) to authenticated;

-- ===========================================================================
-- 7. Enforcement: one guard function, attached to every restricted table
-- ===========================================================================

create or replace function public.age_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rule text := tg_argv[0];
  v_actor uuid := (select auth.uid());
  v_actor_band text;
  v_band text;
  v_creator uuid;
  v_member uuid;
begin
  -- The website's own server code (service role) and migrations.
  if v_actor is null then
    return new;
  end if;
  v_actor_band := public.age_band_of(v_actor);

  if v_rule = 'adult_only' then
    if v_actor_band in ('junior', 'junior_pending', 'youth') then
      raise exception 'This isn''t available to members under 18.' using errcode = '42501';
    end if;

  elsif v_rule = 'conversation' then
    if v_actor_band in ('junior', 'junior_pending', 'youth')
       or public.is_minor(new.user_a_id) or public.is_minor(new.user_b_id) then
      raise exception 'Messages aren''t available to or from members under 18.' using errcode = '42501';
    end if;

  elsif v_rule = 'conversation_member' then
    if v_actor_band in ('junior', 'junior_pending', 'youth') or public.is_minor(new.member_id) then
      raise exception 'Messages aren''t available to or from members under 18.' using errcode = '42501';
    end if;

  elsif v_rule = 'tee_time_invitation' then
    if v_actor_band in ('junior', 'junior_pending', 'youth') or public.is_minor(new.member_id) then
      raise exception 'Tee times aren''t available to members under 18.' using errcode = '42501';
    end if;

  elsif v_rule = 'connection' then
    if v_actor_band in ('junior', 'junior_pending')
       or public.is_under_16(new.requester_id) or public.is_under_16(new.recipient_id) then
      raise exception 'Members under 16 play with contacts their parent approves.' using errcode = '42501';
    end if;

  elsif v_rule = 'group_member' then
    if tg_op = 'UPDATE' and new.role is not distinct from old.role and new.office is not distinct from old.office
       and new.member_id = old.member_id and new.group_id = old.group_id then
      return new;
    end if;
    v_band := public.age_band_of(new.member_id);
    if v_band = 'junior_pending' then
      raise exception 'A parent needs to approve this account first.' using errcode = '42501';
    end if;
    if v_band in ('junior', 'youth') and (new.role <> 'member' or new.office is not null) then
      raise exception 'Members under 18 can''t run a group.' using errcode = '42501';
    end if;
    if v_band = 'junior' and not exists (
      select 1 from public.group_members gm
       where gm.group_id = new.group_id and gm.member_id = public.guardian_of(new.member_id)
    ) then
      raise exception 'Members under 16 can join their parent''s groups only.' using errcode = '42501';
    end if;

  elsif v_rule = 'live_round' then
    if v_actor_band = 'junior_pending' then
      raise exception 'A parent needs to approve this account first.' using errcode = '42501';
    end if;

  elsif v_rule = 'live_player' then
    v_member := new.member_id;
    select r.created_by into v_creator from public.live_rounds r where r.id = new.round_id;
    if v_actor_band = 'junior_pending' then
      raise exception 'A parent needs to approve this account first.' using errcode = '42501';
    end if;
    if v_member is not null then
      v_band := public.age_band_of(v_member);
      if v_band = 'junior_pending' then
        raise exception 'That member''s parent hasn''t approved their account yet.' using errcode = '42501';
      end if;
      -- A 13–15 year old is put in a round only by themselves, their parent,
      -- an approved contact or someone in a group with them…
      if v_band = 'junior' and not (
           public.junior_may_play_with(v_member, v_actor)
           and (v_creator is null or public.junior_may_play_with(v_member, v_creator))
         ) then
        raise exception 'Members under 16 play with their parent and the PinPals their parent approves.' using errcode = '42501';
      end if;
      -- …and adds only those people to theirs.
      if v_actor_band = 'junior' and v_member <> v_actor
         and not public.junior_may_play_with(v_actor, v_member) then
        raise exception 'You can play with your parent and the PinPals they approve.' using errcode = '42501';
      end if;
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.age_guard() from public, anon, authenticated;

do $$
declare
  t record;
begin
  for t in
    select * from (values
      -- Tee times
      ('tee_time_invites', 'adult_only', 'insert'),
      ('tee_time_interests', 'adult_only', 'insert'),
      ('tee_time_invitations', 'tee_time_invitation', 'insert'),
      -- Social
      ('posts', 'adult_only', 'insert'),
      ('post_comments', 'adult_only', 'insert'),
      ('post_likes', 'adult_only', 'insert'),
      ('post_saves', 'adult_only', 'insert'),
      ('post_comment_likes', 'adult_only', 'insert'),
      ('post_images', 'adult_only', 'insert'),
      ('post_videos', 'adult_only', 'insert'),
      ('course_reviews', 'adult_only', 'insert'),
      ('open_partner_requests', 'adult_only', 'insert'),
      -- Chat
      ('conversations', 'conversation', 'insert'),
      ('conversation_members', 'conversation_member', 'insert'),
      ('messages', 'adult_only', 'insert'),
      ('message_reactions', 'adult_only', 'insert'),
      -- Marketplace: browse only
      ('listings', 'adult_only', 'insert'),
      ('offers', 'adult_only', 'insert'),
      ('bids', 'adult_only', 'insert'),
      ('auctions', 'adult_only', 'insert'),
      ('orders', 'adult_only', 'insert'),
      ('reviews', 'adult_only', 'insert'),
      ('stripe_connected_accounts', 'adult_only', 'insert'),
      -- Groups
      ('groups', 'adult_only', 'insert'),
      ('group_members', 'group_member', 'insert or update'),
      -- PinPals
      ('connections', 'connection', 'insert'),
      -- Playing
      ('live_rounds', 'live_round', 'insert'),
      ('live_round_players', 'live_player', 'insert or update of member_id')
    ) as v(tbl, rule, events)
  loop
    if to_regclass('public.' || t.tbl) is null then
      raise notice 'age guard: % not found, skipped', t.tbl;
      continue;
    end if;
    execute format('drop trigger if exists %I on public.%I', t.tbl || '_age_guard', t.tbl);
    execute format(
      'create trigger %I before %s on public.%I for each row execute function public.age_guard(%L)',
      t.tbl || '_age_guard', t.events, t.tbl, t.rule
    );
  end loop;
end;
$$;

-- ===========================================================================
-- 8. Reads
-- ===========================================================================

-- A minor's profile is visible to themselves, staff, their parent, approved
-- contacts, their PinPals, and people they share a group or a round with.
-- Everyone else (the directory, search, suggestions) doesn't see them.
-- Restrictive, so it narrows every existing select policy on profiles.
drop policy if exists "minors are seen by people they play with" on public.profiles;
create policy "minors are seen by people they play with" on public.profiles
  as restrictive
  for select
  to authenticated
  using (public.profile_visible_to_me(id));

-- Social stays empty for under-18s, however it's asked for.
drop policy if exists "no social for under 18s" on public.posts;
create policy "no social for under 18s" on public.posts
  as restrictive for select to authenticated
  using (not (select public.my_is_minor()));

drop policy if exists "no social for under 18s" on public.post_comments;
create policy "no social for under 18s" on public.post_comments
  as restrictive for select to authenticated
  using (not (select public.my_is_minor()));

-- member_suggestions() reads profiles as its owner, past RLS, so it gets
-- the same filter by wrapping. NOTE for later migrations: replace
-- member_suggestions_all(), not this wrapper.
do $$
begin
  if to_regprocedure('public.member_suggestions_all(integer)') is null then
    alter function public.member_suggestions(integer) rename to member_suggestions_all;
  end if;
end;
$$;
revoke all on function public.member_suggestions_all(integer) from public, anon, authenticated;

create or replace function public.member_suggestions(p_limit integer default 20)
returns table (
  id uuid, first_name text, last_name text, avatar_url text, avatar_color text, home_club text,
  handicap numeric, mutual_count integer, same_club boolean, played_together boolean,
  shared_courses integer, distance_km numeric, reason text, score numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select s.* from public.member_suggestions_all(p_limit) s
   where not public.is_minor(s.id) or public.can_see_minor(s.id);
$$;
revoke all on function public.member_suggestions(integer) from public, anon;
grant execute on function public.member_suggestions(integer) to authenticated;

-- Playing together: a parent and child can't be PinPals (under-16s have
-- approved contacts instead), so the round functions' "who may I add" check
-- (live_can_add_player, 0141) also accepts a 13–15 year old's parent and
-- approved contacts, both ways. Same wrapping; later migrations replace
-- live_can_add_player_all().
do $$
begin
  if to_regprocedure('public.live_can_add_player_all(uuid, uuid)') is null then
    alter function public.live_can_add_player(uuid, uuid) rename to live_can_add_player_all;
  end if;
end;
$$;
revoke all on function public.live_can_add_player_all(uuid, uuid) from public, anon, authenticated;

create or replace function public.live_can_add_player(p_me uuid, p_member uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.live_can_add_player_all(p_me, p_member)
      or (p_me is not null and p_member is not null and (
            (public.is_under_16(p_member) and public.junior_may_play_with(p_member, p_me))
         or (public.is_under_16(p_me) and public.junior_may_play_with(p_me, p_member))
      ));
$$;
revoke all on function public.live_can_add_player(uuid, uuid) from public, anon, authenticated;

-- Adverts for under-18s: no alcohol or betting, and nothing targeted at
-- their county, club or country (the DSA bars profiling-based adverts to
-- minors). Same wrapping as above — later migrations replace ads_for_me_all().
do $$
begin
  if to_regprocedure('public.ads_for_me_all(text, text, bigint)') is null then
    alter function public.ads_for_me(text, text, bigint) rename to ads_for_me_all;
  end if;
end;
$$;
revoke all on function public.ads_for_me_all(text, text, bigint) from public, anon, authenticated;

create or replace function public.ads_for_me(
  p_country text default null,
  p_region text default null,
  p_club_id bigint default null
)
returns table (
  id bigint, format text, display_style text, countdown_seconds smallint, takeover_placement text,
  image_url text, image_wide_url text, image_square_url text, headline text, body text, button_text text,
  link_url text, advertiser_name text, advertiser_logo_url text, weight integer, countries text[],
  regions text[], takeover_gap_hours integer
)
language sql
stable
security definer
set search_path = public
as $$
  with minor as (select (select auth.uid()) is not null and public.is_minor((select auth.uid())) as yes)
  select a.*
    from public.ads_for_me_all(
           case when (select yes from minor) then null else p_country end,
           case when (select yes from minor) then null else p_region end,
           case when (select yes from minor) then null else p_club_id end
         ) a
    join public.ad_campaigns c on c.id = a.id
   where not (select yes from minor)
      or (c.category not in ('alcohol', 'betting')
          and cardinality(c.countries) = 0
          and cardinality(c.regions) = 0
          and cardinality(c.club_ids) = 0);
$$;
revoke all on function public.ads_for_me(text, text, bigint) from public;
grant execute on function public.ads_for_me(text, text, bigint) to anon, authenticated;
