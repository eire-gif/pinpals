-- 0200 — Ryder Cup mode for trips (30 Oct 2026, claude/ryder-cup-mode.md)
--
-- Asked by Eire, 30 Oct 2026, from the mock-ups on the canvas "PinPals Ryder
-- Cup Mode": two teams for a whole trip, a format for each round (fourballs,
-- foursomes, greensomes, singles), and one running points total — "Navy 3½ –
-- Gold 1½", 6½ to win, the holders keep the Cup on a tie.
--
-- SHAPE
--
--   trip_cups          one per overnight/abroad trip (society_outings): the
--                      two team names, who holds the Cup, how teams are picked
--   trip_cup_players   who's on which team, and each team's captain
--   trip_cup_sessions  one per round on the itinerary (a second, slot 2, for
--                      an afternoon on a 36-hole day) with its format, and,
--                      once started, its live match day
--   trip_cup_lineups   each captain's order of play for a session, kept
--                      secret from the other side until both are in
--
-- A session IS an ordinary match day (0104) between the cup's two teams:
-- side 1 is team 1. Its matches are scored, shown and finished exactly as
-- Match Day Fun; the Cup's totals are added up on the phone from each
-- session's day (lib/trip-cup.ts), nothing is stored. Deleting a session's
-- day sets the session back to not started.
--
-- WHO CAN DO WHAT
--
--   See:     members of the trip's group (as the itinerary).
--   Set up:  whoever runs the trip (outing_officer): the Cup, the teams,
--            the sessions; starting a session's day.
--   Pick:    in a captains' pick, each captain picks for their own team, in
--            turn: team 1 when the teams are level, else the smaller team.
--   Lineup:  each team's captain (or whoever runs the trip) sends their own
--            team's order. With secret pairings on, a team's lineup is shown
--            only to that team's captain until both are in — not even to
--            whoever runs the trip — then to everyone.
--
-- No primary key here is made of foreign keys alone (see 0199).
-- No drop statements.
--
-- Rollback:
--   drop function if exists public.trip_cup_save(bigint, jsonb), public.trip_cup_cancel(bigint),
--     public.trip_cup_set_teams(bigint, jsonb), public.trip_cup_pick(bigint, uuid),
--     public.trip_cup_save_sessions(bigint, jsonb), public.trip_cup_submit_lineup(bigint, smallint, jsonb),
--     public.trip_cup_lineups(bigint), public.trip_cup_link_session(bigint, bigint),
--     public.trip_cup_officer(bigint, uuid), public.trip_cup_member(bigint, uuid);
--   drop table if exists public.trip_cup_lineups, public.trip_cup_sessions, public.trip_cup_players, public.trip_cups;


-- ============ Tables ============

create table if not exists public.trip_cups (
  id bigint generated always as identity primary key,
  outing_id bigint not null unique references public.society_outings (id) on delete cascade,
  group_id bigint not null references public.groups (id) on delete cascade,
  team_names text[] not null check (
    array_length(team_names, 1) = 2
    and char_length(btrim(team_names[1])) between 1 and 30
    and char_length(btrim(team_names[2])) between 1 and 30
    and lower(btrim(team_names[1])) <> lower(btrim(team_names[2]))
  ),
  holders smallint check (holders in (1, 2)),
  pick_mode text not null default 'captains' check (pick_mode in ('captains', 'balanced', 'random')),
  secret_pairings boolean not null default true,
  status text not null default 'open' check (status in ('open', 'cancelled')),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists trip_cups_group_idx on public.trip_cups (group_id);

create table if not exists public.trip_cup_players (
  id bigint generated always as identity primary key,
  cup_id bigint not null references public.trip_cups (id) on delete cascade,
  member_id uuid not null references public.profiles (id) on delete cascade,
  team smallint not null check (team in (1, 2)),
  captain boolean not null default false,
  picked_at timestamptz not null default now(),
  constraint trip_cup_players_member_key unique (cup_id, member_id)
);
create unique index if not exists trip_cup_players_one_captain_idx on public.trip_cup_players (cup_id, team) where captain;
create index if not exists trip_cup_players_member_idx on public.trip_cup_players (member_id);

create table if not exists public.trip_cup_sessions (
  id bigint generated always as identity primary key,
  cup_id bigint not null references public.trip_cups (id) on delete cascade,
  item_id bigint not null references public.society_outing_items (id) on delete cascade,
  slot smallint not null default 1 check (slot in (1, 2)),
  format text not null check (format in ('fourball', 'foursomes', 'greensomes', 'singles')),
  match_day_id bigint references public.live_match_days (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint trip_cup_sessions_item_slot_key unique (cup_id, item_id, slot)
);
create index if not exists trip_cup_sessions_item_idx on public.trip_cup_sessions (item_id);
create unique index if not exists trip_cup_sessions_match_day_idx on public.trip_cup_sessions (match_day_id) where match_day_id is not null;

create table if not exists public.trip_cup_lineups (
  id bigint generated always as identity primary key,
  session_id bigint not null references public.trip_cup_sessions (id) on delete cascade,
  team smallint not null check (team in (1, 2)),
  -- [[member, member], …] in order of play: match 1 first. One a match for singles.
  pairs jsonb not null check (jsonb_typeof(pairs) = 'array'),
  submitted_by uuid references public.profiles (id) on delete set null,
  submitted_at timestamptz not null default now(),
  constraint trip_cup_lineups_team_key unique (session_id, team)
);

comment on table public.trip_cups is 'Ryder Cup mode (0200): two teams over an overnight/abroad trip, one running points total. Written only through the trip_cup_* functions.';
comment on table public.trip_cup_sessions is 'Ryder Cup mode (0200): one per round on the itinerary (slot 2 = an afternoon). match_day_id is its live match day once started; side 1 is team 1.';
comment on table public.trip_cup_lineups is 'Ryder Cup mode (0200): a captain''s order of play. Never read directly: trip_cup_lineups() keeps the other side''s secret until both are in.';

alter table public.trip_cups enable row level security;
alter table public.trip_cup_players enable row level security;
alter table public.trip_cup_sessions enable row level security;
alter table public.trip_cup_lineups enable row level security;

revoke all on public.trip_cups, public.trip_cup_players, public.trip_cup_sessions, public.trip_cup_lineups from anon;
revoke insert, update, delete, truncate, references, trigger on public.trip_cups, public.trip_cup_players, public.trip_cup_sessions from authenticated;
revoke all on public.trip_cup_lineups from authenticated;
grant select on public.trip_cups, public.trip_cup_players, public.trip_cup_sessions to authenticated;


-- ============ Who ============

create or replace function public.trip_cup_member(p_cup_id bigint, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_user_id is not null and exists (
    select 1 from public.trip_cups c where c.id = p_cup_id and public.is_group_member(c.group_id, p_user_id)
  );
$$;
revoke all on function public.trip_cup_member(bigint, uuid) from public, anon, authenticated;
grant execute on function public.trip_cup_member(bigint, uuid) to authenticated;

create or replace function public.trip_cup_officer(p_cup_id bigint, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_user_id is not null and exists (
    select 1 from public.trip_cups c where c.id = p_cup_id and public.outing_officer(c.group_id, p_user_id)
  );
$$;
revoke all on function public.trip_cup_officer(bigint, uuid) from public, anon, authenticated;
grant execute on function public.trip_cup_officer(bigint, uuid) to authenticated;

create policy "Trip members read the Cup" on public.trip_cups
  for select to authenticated using (public.is_group_member(group_id, (select auth.uid())));
create policy "Trip members read the teams" on public.trip_cup_players
  for select to authenticated using (public.trip_cup_member(cup_id, (select auth.uid())));
create policy "Trip members read the sessions" on public.trip_cup_sessions
  for select to authenticated using (public.trip_cup_member(cup_id, (select auth.uid())));


-- ============ The Cup ============

-- p: { team_names: [a, b], holders: 1 | 2 | null, pick_mode, secret_pairings }
create or replace function public.trip_cup_save(p_outing_id bigint, p jsonb)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := (select auth.uid());
  o public.society_outings%rowtype;
  v_names text[];
  v_holders smallint := nullif(p ->> 'holders', '')::smallint;
  v_mode text := coalesce(nullif(p ->> 'pick_mode', ''), 'captains');
  v_secret boolean := coalesce((p ->> 'secret_pairings')::boolean, true);
  v_id bigint;
begin
  select * into o from public.society_outings where id = p_outing_id;
  if not found or me is null or not public.outing_officer(o.group_id, me) then
    raise exception 'Only whoever runs the trip can set up its Cup.' using errcode = '42501';
  end if;
  if coalesce(o.kind, 'day') = 'day' then raise exception 'A Cup is for overnight and abroad trips.'; end if;
  if o.status <> 'open' then raise exception 'This trip was cancelled.'; end if;
  if jsonb_typeof(p -> 'team_names') = 'array' then
    select array_agg(btrim(x)) into v_names from jsonb_array_elements_text(p -> 'team_names') x;
  end if;
  if v_names is null or array_length(v_names, 1) <> 2
     or char_length(v_names[1]) not between 1 and 30 or char_length(v_names[2]) not between 1 and 30 then
    raise exception 'Name both teams (30 letters at most).';
  end if;
  if lower(v_names[1]) = lower(v_names[2]) then raise exception 'The two teams need different names.'; end if;
  if v_holders is not null and v_holders not in (1, 2) then raise exception 'Choose which team holds the Cup.'; end if;
  if v_mode not in ('captains', 'balanced', 'random') then raise exception 'Choose how the teams are picked.'; end if;

  insert into public.trip_cups (outing_id, group_id, team_names, holders, pick_mode, secret_pairings, created_by)
  values (p_outing_id, o.group_id, v_names, v_holders, v_mode, v_secret, me)
  on conflict (outing_id) do update
     set team_names = excluded.team_names, holders = excluded.holders, pick_mode = excluded.pick_mode,
         secret_pairings = excluded.secret_pairings, status = 'open', updated_at = now()
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.trip_cup_save(bigint, jsonb) from public, anon, authenticated;
grant execute on function public.trip_cup_save(bigint, jsonb) to authenticated;

create or replace function public.trip_cup_cancel(p_cup_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.trip_cup_officer(p_cup_id, (select auth.uid())) then
    raise exception 'Only whoever runs the trip can do that.' using errcode = '42501';
  end if;
  update public.trip_cups set status = 'cancelled', updated_at = now() where id = p_cup_id;
end;
$$;
revoke all on function public.trip_cup_cancel(bigint) from public, anon, authenticated;
grant execute on function public.trip_cup_cancel(bigint) to authenticated;


-- ============ The teams ============

-- Whoever runs the trip: the whole line-up at once (a balanced split or a
-- draw made on the phone, captains named, anyone moved or taken off).
-- p_players: [{ member_id, team: 1 | 2, captain: bool }]
create or replace function public.trip_cup_set_teams(p_cup_id bigint, p_players jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := (select auth.uid());
  c public.trip_cups%rowtype;
  x jsonb;
  v_member uuid;
  v_team smallint;
  v_seen uuid[] := '{}';
begin
  select * into c from public.trip_cups where id = p_cup_id;
  if not found or not public.outing_officer(c.group_id, me) then
    raise exception 'Only whoever runs the trip can change the teams.' using errcode = '42501';
  end if;
  if c.status <> 'open' then raise exception 'This Cup was cancelled.'; end if;
  if jsonb_typeof(p_players) <> 'array' or jsonb_array_length(p_players) > 80 then
    raise exception 'Up to 80 players.';
  end if;
  for x in select * from jsonb_array_elements(p_players) loop
    v_member := nullif(x ->> 'member_id', '')::uuid;
    v_team := nullif(x ->> 'team', '')::smallint;
    if v_member is null or v_team is null or v_team not in (1, 2) then raise exception 'Each player needs a team.'; end if;
    if v_member = any (v_seen) then raise exception 'Someone is on both teams.'; end if;
    v_seen := v_seen || v_member;
    if not public.is_group_member(c.group_id, v_member) then raise exception 'Only members of the trip can play for a team.'; end if;
  end loop;
  if (select count(*) from jsonb_array_elements(p_players) e where coalesce((e ->> 'captain')::boolean, false) and e ->> 'team' = '1') > 1
     or (select count(*) from jsonb_array_elements(p_players) e where coalesce((e ->> 'captain')::boolean, false) and e ->> 'team' = '2') > 1 then
    raise exception 'One captain a team.';
  end if;

  delete from public.trip_cup_players where cup_id = p_cup_id and not (member_id = any (v_seen));
  -- Nobody is captain while the teams change, so a captain moving teams never
  -- meets the old captain's mark; the captains are marked last.
  update public.trip_cup_players set captain = false where cup_id = p_cup_id and captain;
  insert into public.trip_cup_players (cup_id, member_id, team)
  select p_cup_id, (e ->> 'member_id')::uuid, (e ->> 'team')::smallint
    from jsonb_array_elements(p_players) e
  on conflict (cup_id, member_id) do update set team = excluded.team;
  update public.trip_cup_players t
     set captain = true
    from jsonb_array_elements(p_players) e
   where t.cup_id = p_cup_id and t.member_id = (e ->> 'member_id')::uuid and coalesce((e ->> 'captain')::boolean, false);
  update public.trip_cups set updated_at = now() where id = p_cup_id;
end;
$$;
revoke all on function public.trip_cup_set_teams(bigint, jsonb) from public, anon, authenticated;
grant execute on function public.trip_cup_set_teams(bigint, jsonb) to authenticated;

-- A captains' pick: a captain puts a member not yet on a team onto their own,
-- in turn — team 1 when the teams are level, otherwise the smaller team.
create or replace function public.trip_cup_pick(p_cup_id bigint, p_member uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := (select auth.uid());
  c public.trip_cups%rowtype;
  v_team smallint;
  n1 int;
  n2 int;
begin
  select * into c from public.trip_cups where id = p_cup_id for update;
  if not found or me is null then raise exception 'That Cup has gone.'; end if;
  if c.status <> 'open' then raise exception 'This Cup was cancelled.'; end if;
  if c.pick_mode <> 'captains' then raise exception 'The teams aren''t a captains'' pick.'; end if;
  select team into v_team from public.trip_cup_players where cup_id = p_cup_id and member_id = me and captain;
  if v_team is null then raise exception 'Only the captains pick.' using errcode = '42501'; end if;
  select count(*) filter (where team = 1), count(*) filter (where team = 2) into n1, n2
    from public.trip_cup_players where cup_id = p_cup_id;
  if not ((v_team = 1 and n1 <= n2) or (v_team = 2 and n2 < n1)) then
    raise exception 'It''s the other captain''s pick.';
  end if;
  if p_member is null or not public.is_group_member(c.group_id, p_member) then
    raise exception 'Only members of the trip can be picked.';
  end if;
  if exists (select 1 from public.trip_cup_players where cup_id = p_cup_id and member_id = p_member) then
    raise exception 'They''re already on a team.';
  end if;
  insert into public.trip_cup_players (cup_id, member_id, team) values (p_cup_id, p_member, v_team);
  update public.trip_cups set updated_at = now() where id = p_cup_id;
end;
$$;
revoke all on function public.trip_cup_pick(bigint, uuid) from public, anon, authenticated;
grant execute on function public.trip_cup_pick(bigint, uuid) to authenticated;


-- ============ The sessions ============

-- p_sessions: [{ item_id, slot: 1 | 2, format }] — every session not yet
-- started; one left out is taken away. Started sessions are kept as they are.
create or replace function public.trip_cup_save_sessions(p_cup_id bigint, p_sessions jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := (select auth.uid());
  c public.trip_cups%rowtype;
  x jsonb;
  v_item bigint;
  v_slot smallint;
  v_format text;
  v_keep bigint[] := '{}';
  v_id bigint;
begin
  select * into c from public.trip_cups where id = p_cup_id;
  if not found or not public.outing_officer(c.group_id, me) then
    raise exception 'Only whoever runs the trip can plan the sessions.' using errcode = '42501';
  end if;
  if c.status <> 'open' then raise exception 'This Cup was cancelled.'; end if;
  if jsonb_typeof(p_sessions) <> 'array' or jsonb_array_length(p_sessions) > 12 then
    raise exception 'Up to 12 sessions.';
  end if;
  for x in select * from jsonb_array_elements(p_sessions) loop
    v_item := nullif(x ->> 'item_id', '')::bigint;
    v_slot := coalesce(nullif(x ->> 'slot', '')::smallint, 1);
    v_format := x ->> 'format';
    if v_slot not in (1, 2) then raise exception 'A round has a morning and an afternoon session at most.'; end if;
    if v_format is null or v_format not in ('fourball', 'foursomes', 'greensomes', 'singles') then
      raise exception 'Each session needs a format: fourballs, foursomes, greensomes or singles.';
    end if;
    if not exists (select 1 from public.society_outing_items where id = v_item and outing_id = c.outing_id and kind = 'round') then
      raise exception 'A session is a round on this trip''s itinerary.';
    end if;
    insert into public.trip_cup_sessions (cup_id, item_id, slot, format)
    values (p_cup_id, v_item, v_slot, v_format)
    on conflict (cup_id, item_id, slot) do update
       set format = case when trip_cup_sessions.match_day_id is null then excluded.format else trip_cup_sessions.format end
    returning id into v_id;
    v_keep := v_keep || v_id;
  end loop;
  delete from public.trip_cup_sessions where cup_id = p_cup_id and match_day_id is null and not (id = any (v_keep));
  update public.trip_cups set updated_at = now() where id = p_cup_id;
end;
$$;
revoke all on function public.trip_cup_save_sessions(bigint, jsonb) from public, anon, authenticated;
grant execute on function public.trip_cup_save_sessions(bigint, jsonb) to authenticated;

-- A team's order of play for a session: [[member], …] for singles,
-- [[member, member], …] otherwise. Its captain, or whoever runs the trip.
create or replace function public.trip_cup_submit_lineup(p_session_id bigint, p_team smallint, p_pairs jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := (select auth.uid());
  s public.trip_cup_sessions%rowtype;
  c public.trip_cups%rowtype;
  v_size int;
  x jsonb;
  m text;
  v_seen uuid[] := '{}';
begin
  select * into s from public.trip_cup_sessions where id = p_session_id;
  if not found then raise exception 'That session has gone.'; end if;
  select * into c from public.trip_cups where id = s.cup_id;
  if p_team is null or p_team not in (1, 2) then raise exception 'Which team?'; end if;
  if me is null or not (
       public.outing_officer(c.group_id, me)
       or exists (select 1 from public.trip_cup_players where cup_id = c.id and member_id = me and team = p_team and captain)
     ) then
    raise exception 'Only the team''s captain sends its lineup.' using errcode = '42501';
  end if;
  if c.status <> 'open' then raise exception 'This Cup was cancelled.'; end if;
  if s.match_day_id is not null then raise exception 'This session has started.'; end if;
  v_size := case when s.format = 'singles' then 1 else 2 end;
  if jsonb_typeof(p_pairs) <> 'array' or jsonb_array_length(p_pairs) not between 1 and 30 then
    raise exception 'Put your players in order.';
  end if;
  for x in select * from jsonb_array_elements(p_pairs) loop
    if jsonb_typeof(x) <> 'array' or jsonb_array_length(x) <> v_size then
      raise exception '%', case when v_size = 1 then 'Singles is one player a match.' else 'Pairs matches are two a side.' end;
    end if;
    for m in select * from jsonb_array_elements_text(x) loop
      if m::uuid = any (v_seen) then raise exception 'Someone is in two matches.'; end if;
      v_seen := v_seen || m::uuid;
      if not exists (select 1 from public.trip_cup_players where cup_id = c.id and member_id = m::uuid and team = p_team) then
        raise exception 'Only your own team''s players.';
      end if;
    end loop;
  end loop;
  insert into public.trip_cup_lineups (session_id, team, pairs, submitted_by)
  values (p_session_id, p_team, p_pairs, me)
  on conflict (session_id, team) do update set pairs = excluded.pairs, submitted_by = excluded.submitted_by, submitted_at = now();
end;
$$;
revoke all on function public.trip_cup_submit_lineup(bigint, smallint, jsonb) from public, anon, authenticated;
grant execute on function public.trip_cup_submit_lineup(bigint, smallint, jsonb) to authenticated;

-- The lineups this member may see for a session. A team's is shown to its
-- own captain at once; to everyone else once both are in, once the session
-- has started, or at any time when pairings aren't secret. `pairs` is null
-- (with its time) for one sent but not yet shown, so "Navy's lineup is in"
-- can still be said.
create or replace function public.trip_cup_lineups(p_session_id bigint)
returns table (team smallint, pairs jsonb, submitted_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  me uuid := (select auth.uid());
  s public.trip_cup_sessions%rowtype;
  c public.trip_cups%rowtype;
  v_both boolean;
  v_my_captaincy smallint;
begin
  select * into s from public.trip_cup_sessions where id = p_session_id;
  if not found then return; end if;
  select * into c from public.trip_cups where id = s.cup_id;
  if me is null or not public.is_group_member(c.group_id, me) then return; end if;
  v_both := (select count(*) from public.trip_cup_lineups l where l.session_id = p_session_id) = 2;
  select p.team into v_my_captaincy from public.trip_cup_players p where p.cup_id = c.id and p.member_id = me and p.captain;
  return query
    select l.team,
           case when not c.secret_pairings or v_both or s.match_day_id is not null or l.team = v_my_captaincy
                then l.pairs else null end,
           l.submitted_at
      from public.trip_cup_lineups l
     where l.session_id = p_session_id
     order by l.team;
end;
$$;
revoke all on function public.trip_cup_lineups(bigint) from public, anon, authenticated;
grant execute on function public.trip_cup_lineups(bigint) to authenticated;

-- A session's live day, once whoever runs the trip has started it. A
-- morning session's day is also the round's (0187), so the trip's
-- leaderboard and itinerary know it.
create or replace function public.trip_cup_link_session(p_session_id bigint, p_match_day_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := (select auth.uid());
  s public.trip_cup_sessions%rowtype;
  c public.trip_cups%rowtype;
begin
  select * into s from public.trip_cup_sessions where id = p_session_id;
  if not found then raise exception 'That session has gone.'; end if;
  select * into c from public.trip_cups where id = s.cup_id;
  if me is null or not public.outing_officer(c.group_id, me) then
    raise exception 'Only whoever runs the trip can start a session.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.live_match_days where id = p_match_day_id and created_by = me) then
    raise exception 'That isn''t your match day.';
  end if;
  if s.match_day_id is not null and s.match_day_id <> p_match_day_id then
    raise exception 'This session has already started.';
  end if;
  update public.trip_cup_sessions set match_day_id = p_match_day_id where id = p_session_id;
  if s.slot = 1 then
    update public.society_outing_items set match_day_id = p_match_day_id where id = s.item_id and match_day_id is null;
  end if;
end;
$$;
revoke all on function public.trip_cup_link_session(bigint, bigint) from public, anon, authenticated;
grant execute on function public.trip_cup_link_session(bigint, bigint) to authenticated;
