-- 0188 — Trust & safety (Oct 2026, claude/trust-and-safety.md)
--
-- Three things that make playing with, and buying from, strangers feel safe:
--
--   1. RELIABILITY. Shows vs no-shows vs late cancellations on tee times.
--      Only the exceptions are stored (tee_time_attendance): a round a
--      golfer confirmed, that went ahead and that nobody marked otherwise,
--      counts as played. member_reliability() turns that into a badge.
--        * A late cancellation is giving back a CONFIRMED place less than
--          24 hours before the tee time (Irish time) — recorded by a
--          trigger, so every route that drops a place (website, app,
--          confirm_tee_time_place) is covered without touching it. A host
--          cancelling a round with confirmed players inside 24 hours gets
--          one too. Rejoining the same round wipes it.
--        * A no-show is marked by the HOST, after the round, within 7 days
--          (mark_tee_time_no_show). It is refused when the golfer has a
--          live scorecard from that day with the host or at that club —
--          the live round is the proof they turned up. The golfer is told
--          and can dispute it (dispute_tee_time_attendance); a disputed
--          no-show stops counting unless staff uphold it.
--        * Last 12 months only, so a bad patch doesn't follow anyone for
--          ever. Fewer than 3 rounds on record reads "new".
--      tee_time_invites.reliable_only lets a host ask for golfers with a
--      good record: a member whose record is 'patchy' can't ask to join or
--      take a place on it (new members still can). Hosts inviting someone
--      directly are never blocked.
--
--   2. VERIFIED MEMBERS. member_verifications holds a member's own
--      submission (Golf Ireland number, club, the check's result) — owner
--      read only, written by the website with the service role after an
--      AI check of their membership card (src/lib/verification). The card
--      photo is never kept unless the check needs a person to look, and
--      is deleted once they have. verified_members is the small public
--      table every profile reads for the badge.
--
--   3. MARKETPLACE SAFETY FLAGS. messages.safety_flags, set on insert in a
--      marketplace conversation (conversations.listing_id) when a message
--      carries a link, asks for money before the handover, mentions a
--      courier/agent, gift cards/crypto/PayPal friends & family, or tries
--      to move the chat off PinPals. Flags are shown to the OTHER person as
--      a warning; nothing is blocked. Also corrects the card-number
--      message's out-of-date "payment happens through Pinpals checkout".
--
-- Additive: new tables, new columns with defaults, new functions and
-- triggers. No drops of data.
--
-- ROLLBACK:
--   drop trigger if exists tee_time_interests_late_cancel on public.tee_time_interests;
--   drop trigger if exists tee_time_invites_late_cancel on public.tee_time_invites;
--   drop trigger if exists tee_time_interests_reliable_only on public.tee_time_interests;
--   drop trigger if exists messages_safety_flags on public.messages;
--   drop function if exists public.tee_time_starts_at(bigint), public.record_late_cancel(),
--     public.record_host_late_cancel(), public.enforce_reliable_only(),
--     public.member_reliability(uuid[]), public.mark_tee_time_no_show(bigint, uuid, boolean),
--     public.dispute_tee_time_attendance(bigint, text), public.played_live_that_day(bigint, uuid),
--     public.message_safety_flags(text), public.set_message_safety_flags();
--   drop table if exists public.tee_time_attendance, public.member_verifications, public.verified_members;
--   alter table public.tee_time_invites drop column if exists reliable_only;
--   alter table public.messages drop column if exists safety_flags;
--   delete from storage.buckets where id = 'verification-cards';
--   then re-run validate_message_content() from 0049.


-- ============ 1. RELIABILITY ============

alter table public.tee_time_invites
  add column if not exists reliable_only boolean not null default false;

comment on column public.tee_time_invites.reliable_only is
  'Host asked for golfers with a good record of turning up. Enforced on self-initiated requests/takes by enforce_reliable_only() (0188); new members are let through.';

create table if not exists public.tee_time_attendance (
  id bigint generated always as identity primary key,
  invite_id bigint not null references public.tee_time_invites (id) on delete cascade,
  member_id uuid not null references public.profiles (id) on delete cascade,
  outcome text not null check (outcome in ('no_show', 'late_cancel')),
  -- Hours between giving the place back and the tee time (late_cancel only).
  hours_notice numeric(6, 1),
  recorded_by uuid references public.profiles (id) on delete set null,
  recorded_at timestamptz not null default now(),
  disputed_at timestamptz,
  dispute_note text check (dispute_note is null or char_length(dispute_note) <= 500),
  resolution text check (resolution is null or resolution in ('upheld', 'overturned')),
  resolved_by uuid references auth.users (id),
  resolved_at timestamptz,
  unique (invite_id, member_id)
);

create index if not exists tee_time_attendance_member_idx
  on public.tee_time_attendance (member_id, recorded_at desc);
create index if not exists tee_time_attendance_disputed_idx
  on public.tee_time_attendance (disputed_at) where disputed_at is not null and resolution is null;

alter table public.tee_time_attendance enable row level security;

-- The golfer sees their own record; the host sees what's on their round.
-- Writes only through the functions below (and the service role for staff).
drop policy if exists "own or hosted attendance" on public.tee_time_attendance;
create policy "own or hosted attendance" on public.tee_time_attendance
  for select to authenticated
  using (
    member_id = (select auth.uid())
    or exists (
      select 1 from public.tee_time_invites t
       where t.id = invite_id and t.member_id = (select auth.uid())
    )
  );

-- When a round starts, in Irish time. An exact tee time first, then the
-- start of the window, then 8am for a round posted as "any time that day".
create or replace function public.tee_time_starts_at(p_invite_id bigint)
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  select ((t.play_date + coalesce(t.exact_tee_time, t.time_from, time '08:00'))::timestamp
            at time zone 'Europe/Dublin')
    from public.tee_time_invites t
   where t.id = p_invite_id;
$$;
revoke all on function public.tee_time_starts_at(bigint) from public, anon, authenticated;

-- A golfer gives back a confirmed place.
create or replace function public.record_late_cancel()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_starts timestamptz;
  v_status text;
begin
  -- Rejoined the same round: the late cancellation no longer stands.
  if new.status = 'confirmed' and old.status is distinct from 'confirmed' then
    delete from public.tee_time_attendance
     where invite_id = new.invite_id and member_id = new.member_id and outcome = 'late_cancel';
    return new;
  end if;

  if not (old.status = 'confirmed' and new.status = 'declined' and new.withdrawn_at is not null) then
    return new;
  end if;

  select status into v_status from public.tee_time_invites where id = new.invite_id;
  if v_status = 'cancelled' then
    return new;
  end if;

  v_starts := public.tee_time_starts_at(new.invite_id);
  if v_starts is null or v_starts - now() >= interval '24 hours' then
    return new;
  end if;

  insert into public.tee_time_attendance (invite_id, member_id, outcome, hours_notice, recorded_by)
  values (
    new.invite_id, new.member_id, 'late_cancel',
    greatest(0, round((extract(epoch from (v_starts - now())) / 3600)::numeric, 1)),
    new.member_id
  )
  on conflict (invite_id, member_id) do nothing;

  return new;
end;
$$;
revoke all on function public.record_late_cancel() from public, anon, authenticated;

drop trigger if exists tee_time_interests_late_cancel on public.tee_time_interests;
create trigger tee_time_interests_late_cancel
  after update of status on public.tee_time_interests
  for each row
  execute function public.record_late_cancel();

-- A host calls off a round that had people confirmed on it.
create or replace function public.record_host_late_cancel()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_starts timestamptz;
begin
  if not (new.status = 'cancelled' and old.status is distinct from 'cancelled') then
    return new;
  end if;
  if not exists (
    select 1 from public.tee_time_interests i
     where i.invite_id = new.id and i.status = 'confirmed' and i.member_id <> new.member_id
  ) then
    return new;
  end if;

  v_starts := public.tee_time_starts_at(new.id);
  if v_starts is null or v_starts - now() >= interval '24 hours' then
    return new;
  end if;

  insert into public.tee_time_attendance (invite_id, member_id, outcome, hours_notice, recorded_by)
  values (
    new.id, new.member_id, 'late_cancel',
    greatest(0, round((extract(epoch from (v_starts - now())) / 3600)::numeric, 1)),
    new.member_id
  )
  on conflict (invite_id, member_id) do nothing;
  return new;
end;
$$;
revoke all on function public.record_host_late_cancel() from public, anon, authenticated;

drop trigger if exists tee_time_invites_late_cancel on public.tee_time_invites;
create trigger tee_time_invites_late_cancel
  after update of status on public.tee_time_invites
  for each row
  execute function public.record_host_late_cancel();

-- Did this golfer score a live round on the day of this tee time, with the
-- host or at the same club? That is proof they turned up.
create or replace function public.played_live_that_day(p_invite_id bigint, p_member uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.tee_time_invites t
      join public.live_rounds r on r.played_on = t.play_date
      join public.live_round_players me on me.round_id = r.id and me.member_id = p_member
     where t.id = p_invite_id
       and (
         (t.club_id is not null and r.club_id = t.club_id)
         or exists (select 1 from public.live_round_players h
                     where h.round_id = r.id and h.member_id = t.member_id)
       )
  );
$$;
revoke all on function public.played_live_that_day(bigint, uuid) from public, anon, authenticated;

-- The badge, for any number of members at once (a list of requests, a
-- profile). Counted over the last 12 months:
--   played       rounds hosted (with someone confirmed) or confirmed on,
--                not cancelled, already started, and not a counted no-show
--   no_shows     marked by the host, not overturned, not under dispute
--   late_cancels within 24 hours, as above
-- level: 'new' under 3 on record; 'reliable' 90%+; 'mostly' 75%+; else 'patchy'.
create or replace function public.member_reliability(p_members uuid[])
returns table (
  member_id uuid,
  rounds_played integer,
  no_shows integer,
  late_cancels integer,
  level text
)
language sql
stable
security definer
set search_path = public
as $$
  with ids as (
    select distinct unnest(p_members) as member_id
     limit 200
  ),
  counted as (
    select a.member_id, a.invite_id, a.outcome
      from public.tee_time_attendance a
      join ids on ids.member_id = a.member_id
     where a.recorded_at > now() - interval '12 months'
       and coalesce(a.resolution, '') <> 'overturned'
       and (a.disputed_at is null or a.resolution = 'upheld')
  ),
  rounds as (
    -- hosted
    select t.member_id, t.id as invite_id
      from public.tee_time_invites t
      join ids on ids.member_id = t.member_id
     where t.status <> 'cancelled'
       and t.play_date > current_date - 365
       and t.play_date <= (now() at time zone 'Europe/Dublin')::date
       and exists (select 1 from public.tee_time_interests i
                    where i.invite_id = t.id and i.status = 'confirmed' and i.member_id <> t.member_id)
    union
    -- played on someone else's
    select i.member_id, t.id
      from public.tee_time_interests i
      join ids on ids.member_id = i.member_id
      join public.tee_time_invites t on t.id = i.invite_id
     where i.status = 'confirmed'
       and t.status <> 'cancelled'
       and t.member_id <> i.member_id
       and t.play_date > current_date - 365
       and t.play_date <= (now() at time zone 'Europe/Dublin')::date
  ),
  totals as (
    select ids.member_id,
           (select count(*) from rounds r
             where r.member_id = ids.member_id
               and not exists (select 1 from counted c
                                where c.member_id = r.member_id and c.invite_id = r.invite_id
                                  and c.outcome = 'no_show'))::int as played,
           (select count(*) from counted c where c.member_id = ids.member_id and c.outcome = 'no_show')::int as no_shows,
           (select count(*) from counted c where c.member_id = ids.member_id and c.outcome = 'late_cancel')::int as late_cancels
      from ids
  )
  select member_id, played, no_shows, late_cancels,
         case
           when played + no_shows + late_cancels < 3 then 'new'
           when played::numeric / (played + no_shows + late_cancels) >= 0.9 then 'reliable'
           when played::numeric / (played + no_shows + late_cancels) >= 0.75 then 'mostly'
           else 'patchy'
         end
    from totals;
$$;
revoke all on function public.member_reliability(uuid[]) from public, anon, authenticated;
grant execute on function public.member_reliability(uuid[]) to authenticated, service_role;

-- The host, after the round: "X didn't turn up" (or undo it).
create or replace function public.mark_tee_time_no_show(
  p_invite_id bigint,
  p_member uuid,
  p_no_show boolean
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_invite public.tee_time_invites%rowtype;
  v_club text;
begin
  select * into v_invite from public.tee_time_invites where id = p_invite_id;
  if not found or v_invite.member_id is distinct from v_me then
    raise exception 'Only the host of this round can say who turned up.';
  end if;
  if v_invite.status = 'cancelled' then
    raise exception 'This round was cancelled.';
  end if;
  if public.tee_time_starts_at(p_invite_id) > now() then
    raise exception 'You can say who turned up once the round has started.';
  end if;
  if v_invite.play_date < (now() at time zone 'Europe/Dublin')::date - 7 then
    raise exception 'It''s more than a week since this round, so it can''t be changed now.';
  end if;
  if not exists (select 1 from public.tee_time_interests
                  where invite_id = p_invite_id and member_id = p_member and status = 'confirmed') then
    raise exception 'That golfer wasn''t confirmed on this round.';
  end if;

  if not p_no_show then
    delete from public.tee_time_attendance
     where invite_id = p_invite_id and member_id = p_member and outcome = 'no_show';
    return 'cleared';
  end if;

  if public.played_live_that_day(p_invite_id, p_member) then
    raise exception 'They have a live scorecard from that day, so they turned up.';
  end if;

  insert into public.tee_time_attendance (invite_id, member_id, outcome, recorded_by)
  values (p_invite_id, p_member, 'no_show', v_me)
  on conflict (invite_id, member_id) do update
     set outcome = 'no_show', recorded_by = v_me, recorded_at = now(),
         disputed_at = null, dispute_note = null, resolution = null, resolved_by = null, resolved_at = null;

  v_club := coalesce((select name from public.clubs where id = v_invite.club_id), v_invite.club_name, 'your round');
  perform public.notify_user(
    p_member,
    'tee_time_no_show',
    'Marked as not turning up',
    format('The host of %s on %s said you didn''t turn up. If that''s wrong, you can dispute it.',
           v_club, to_char(v_invite.play_date, 'FMDay DD Mon')),
    jsonb_build_object('href', '/tee-times/mine?invite=' || p_invite_id, 'invite_id', p_invite_id),
    'no_show:' || p_invite_id || ':' || p_member
  );
  return 'marked';
end;
$$;
revoke all on function public.mark_tee_time_no_show(bigint, uuid, boolean) from public, anon, authenticated;
grant execute on function public.mark_tee_time_no_show(bigint, uuid, boolean) to authenticated;

-- The golfer: "that's not right". It stops counting straight away.
create or replace function public.dispute_tee_time_attendance(p_invite_id bigint, p_note text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
begin
  update public.tee_time_attendance
     set disputed_at = now(),
         dispute_note = nullif(left(btrim(coalesce(p_note, '')), 500), '')
   where invite_id = p_invite_id
     and member_id = v_me
     and disputed_at is null
     and resolution is null
     and recorded_at > now() - interval '30 days';
  if not found then
    raise exception 'There''s nothing on this round you can dispute.';
  end if;
end;
$$;
revoke all on function public.dispute_tee_time_attendance(bigint, text) from public, anon, authenticated;
grant execute on function public.dispute_tee_time_attendance(bigint, text) to authenticated;

-- "Only golfers with a good record": refused for a patchy record, on the
-- golfer's own request or take. A host inviting someone isn't checked.
create or replace function public.enforce_reliable_only()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_level text;
begin
  if (select auth.uid()) is distinct from new.member_id then
    return new;
  end if;
  if not exists (select 1 from public.tee_time_invites where id = new.invite_id and reliable_only) then
    return new;
  end if;
  select level into v_level from public.member_reliability(array[new.member_id]);
  if v_level = 'patchy' then
    raise exception 'This host has asked for golfers with a good record of turning up. Play a few rounds without missing one and you''ll be able to ask.';
  end if;
  return new;
end;
$$;
revoke all on function public.enforce_reliable_only() from public, anon, authenticated;

drop trigger if exists tee_time_interests_reliable_only on public.tee_time_interests;
create trigger tee_time_interests_reliable_only
  before insert on public.tee_time_interests
  for each row
  execute function public.enforce_reliable_only();


-- ============ 2. VERIFIED MEMBERS ============

create table if not exists public.member_verifications (
  member_id uuid primary key references public.profiles (id) on delete cascade,
  golf_ireland_number text not null check (char_length(btrim(golf_ireland_number)) between 3 and 40),
  club_id bigint references public.clubs (id) on delete set null,
  club_name text not null check (char_length(btrim(club_name)) between 1 and 120),
  status text not null default 'checking'
    check (status in ('checking', 'verified', 'needs_review', 'rejected')),
  method text check (method is null or method in ('ai', 'admin')),
  -- Only while a person needs to look (needs_review). Cleared once decided.
  photo_path text,
  ai_result jsonb,
  -- What the member is told when it isn't approved.
  reason text check (reason is null or char_length(reason) <= 500),
  attempts smallint not null default 0,
  submitted_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references auth.users (id)
);

create index if not exists member_verifications_review_idx
  on public.member_verifications (submitted_at) where status = 'needs_review';

alter table public.member_verifications enable row level security;

drop policy if exists "own verification" on public.member_verifications;
create policy "own verification" on public.member_verifications
  for select to authenticated using (member_id = (select auth.uid()));
-- No insert/update/delete for members: the website writes with the service
-- role after the check (src/app/api/app/verification).

-- The badge itself. Readable by every signed-in member.
create table if not exists public.verified_members (
  member_id uuid primary key references public.profiles (id) on delete cascade,
  club_name text,
  verified_at timestamptz not null default now()
);

alter table public.verified_members enable row level security;

drop policy if exists "anyone signed in sees the badge" on public.verified_members;
create policy "anyone signed in sees the badge" on public.verified_members
  for select to authenticated using (true);

-- Card photos waiting for a person. Private; service role only.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('verification-cards', 'verification-cards', false, 6291456,
        array['image/jpeg', 'image/png', 'image/webp', 'image/heic'])
on conflict (id) do nothing;


-- ============ 3. MARKETPLACE SAFETY FLAGS ============

alter table public.messages
  add column if not exists safety_flags text[];

comment on column public.messages.safety_flags is
  'Marketplace chats only (0188): link, pay_first, courier, odd_payment, off_app. Shown to the other person as a warning. Never blocks a message.';

-- Pure function so it can be tested on its own.
create or replace function public.message_safety_flags(p_body text)
returns text[]
language plpgsql
immutable
set search_path = public
as $$
declare
  v text := lower(coalesce(p_body, ''));
  v_flags text[] := '{}';
  v_links text;
begin
  -- Links, ignoring our own (pinpals.ie / pinpals.com share links).
  v_links := regexp_replace(v, '(https?://)?(www\.)?pinpals\.(ie|com)\S*', '', 'g');
  if v_links ~ '(https?://|www\.)\S+'
     or v_links ~ '\m[a-z0-9-]{2,}\.(com|ie|net|org|co\.uk|uk|io|ly|me|app|link|info|shop|store|xyz|top|site|online)(/\S*)?(\s|$|[.,!?)])'
  then
    v_flags := array_append(v_flags, 'link');
  end if;

  if v ~ '(deposit|holding fee|pay (it )?(up ?front|first|in advance|before)|send (the |me the )?(money|payment|cash) (first|before|now)|transfer (it |the money )?(first|before)|reserve (it|them) (for|with) (a|some) (payment|money)|pay (now|today) (and|to) (hold|reserve))' then
    v_flags := array_append(v_flags, 'pay_first');
  end if;

  if v ~ '(courier|shipping (agent|company)|delivery (agent|company|fee)|\mdhl\M|fedex|\mups\M|\man post\M|clearance fee|customs fee|payment link)' then
    v_flags := array_append(v_flags, 'courier');
  end if;

  if v ~ '(gift ?card|itunes|steam card|google play card|bitcoin|\mbtc\M|crypto|\musdt\M|western union|moneygram|paypal (friends|f ?& ?f|family)|friends and family)' then
    v_flags := array_append(v_flags, 'odd_payment');
  end if;

  if v ~ '(whats ?app|\mwa\.me|telegram|signal app|text me on|email me (at|on)|@(gmail|yahoo|hotmail|outlook|icloud|live)\.)' then
    v_flags := array_append(v_flags, 'off_app');
  end if;

  return case when cardinality(v_flags) = 0 then null else v_flags end;
end;
$$;
grant execute on function public.message_safety_flags(text) to authenticated, service_role;

create or replace function public.set_message_safety_flags()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from public.conversations c
              where c.id = new.conversation_id and c.listing_id is not null) then
    new.safety_flags := public.message_safety_flags(new.body);
  else
    new.safety_flags := null;
  end if;
  return new;
end;
$$;
revoke all on function public.set_message_safety_flags() from public, anon, authenticated;

drop trigger if exists messages_safety_flags on public.messages;
create trigger messages_safety_flags
  before insert on public.messages
  for each row
  execute function public.set_message_safety_flags();

-- The card-number refusal still told people to pay "through Pinpals
-- checkout", which the cash marketplace no longer has. Same rules, current
-- wording.
create or replace function public.validate_message_content()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_compact text;
begin
  if auth.uid() is null or public.is_staff() then
    return new;
  end if;

  if new.body ~ '[0-9](?:[ -]?[0-9]){12,18}' then
    raise exception 'Messages can''t include what looks like a card number. Never share card details in chat — pay in person, by cash or Revolut, when you see the item.';
  end if;

  v_compact := regexp_replace(new.body, '[ -]', '', 'g');
  if v_compact ~ '[A-Za-z]{2}[0-9]{2}[A-Za-z0-9]{11,30}' then
    raise exception 'Messages can''t include what looks like a bank account or IBAN number.';
  end if;

  if new.body ~* '(passport|pps\s*(no|number)?|social security|ssn|sort code|routing number|verification code|\motp\M)\D{0,15}(?:[0-9][ -]?){3,}[0-9]' then
    raise exception 'Messages can''t include identity-verification numbers or codes.';
  end if;

  return new;
end;
$$;
revoke all on function public.validate_message_content() from public, anon, authenticated;
