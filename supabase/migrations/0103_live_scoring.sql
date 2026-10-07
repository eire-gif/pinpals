-- Live scoring (Oct 2026).
--
-- A group starts a round in the app, picks a format, adds players (their
-- PinPals and guests by name) and scores hole by hole. Everyone in the round
-- sees the leaderboard move as scores go in.
--
-- WHAT IS STORED, AND WHY THIS SHAPE
--
--   live_rounds         one round: course, format, the course's rating and
--                       slope if known, the format's handicap allowance.
--   live_round_players  up to 8. A member (member_id) or a guest (name only).
--                       The handicap INDEX each player entered, and the
--                       course and playing handicaps worked out from it on
--                       the phone (src/lib/live-scoring.ts).
--   live_round_holes    the round's own copy of the card: par and stroke
--                       index per hole. Most Irish courses have no stroke
--                       indexes on file yet (see claude/live-scoring.md), so
--                       the scorer enters them from the card as they go.
--                       A copy, not a link to a course table, so a later
--                       correction to a course never rewrites a finished round.
--   live_round_scores   strokes per player per hole. NULL strokes = picked up.
--
-- The points, positions and match status are NOT stored. They are worked out
-- from these rows by live-scoring.ts on every read, so there is nothing to
-- drift out of step when someone corrects the 7th.
--
-- WHO CAN DO WHAT
--
--   Read: the member who started the round and every member playing in it.
--   Write: the same people, and only through the functions below — there are
--   no insert/update/delete policies, so the tables can't be written directly.
--   Any player may mark for anyone in the group, which is how a card works.
--   Members can only be added to a round by one of their accepted PinPals
--   (or themselves), and never across a block: nobody can put a stranger's
--   name on a leaderboard.
--
-- LIVE
--
--   Every score or card change broadcasts a "changed" ping on the private
--   topic live-round-<id>. The payload is "go re-fetch", never data to
--   render — the same rule as the inbox channel (0082). A failed broadcast
--   never fails the write: Postgres is the record, the ping is a courtesy.
--
-- ACCOUNT DELETION
--
--   A deleted member's player row stays (the others' leaderboard must still
--   add up) but loses its link and its name: member_id is set null and a
--   trigger renames it "Former member".
--
-- Rollback:
--   drop function if exists public.live_round_create(jsonb, jsonb, jsonb);
--   drop function if exists public.live_round_set_score(bigint, bigint, smallint, smallint, boolean);
--   drop function if exists public.live_round_set_hole(bigint, smallint, smallint, smallint);
--   drop function if exists public.live_round_finish(bigint);
--   drop policy if exists "Players receive their live round broadcasts" on realtime.messages;
--   drop table if exists public.live_round_scores, public.live_round_holes,
--     public.live_round_players, public.live_rounds cascade;
--   drop function if exists public.can_view_live_round(bigint);
--   drop function if exists public.realtime_live_round_id(text);
--   drop function if exists public.live_round_broadcast();
--   drop function if exists public.live_round_status_broadcast();
--   drop function if exists public.live_round_player_forget_name();

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.live_rounds (
  id bigint generated always as identity primary key,
  created_by uuid references public.profiles (id) on delete set null,
  club_id bigint references public.clubs (id) on delete set null,
  course_name text not null check (char_length(btrim(course_name)) between 1 and 120),
  tee_name text check (tee_name is null or char_length(btrim(tee_name)) between 1 and 40),
  format text not null check (format in ('stableford', 'stroke', 'matchplay')),
  holes smallint not null default 18 check (holes in (9, 18)),
  course_rating numeric(4, 1) check (course_rating is null or course_rating between 25 and 85),
  slope smallint check (slope is null or slope between 55 and 155),
  par_total smallint check (par_total is null or par_total between 27 and 80),
  allowance numeric(3, 2) not null check (allowance > 0 and allowance <= 1),
  status text not null default 'live' check (status in ('live', 'finished')),
  played_on date not null default current_date,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

create index live_rounds_created_by_idx on public.live_rounds (created_by, created_at desc);

create table public.live_round_players (
  id bigint generated always as identity primary key,
  round_id bigint not null references public.live_rounds (id) on delete cascade,
  member_id uuid references public.profiles (id) on delete set null,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 60),
  handicap_index numeric(3, 1) not null check (handicap_index between -10 and 54),
  course_handicap smallint not null check (course_handicap between -20 and 80),
  playing_handicap smallint not null check (playing_handicap between -20 and 80),
  handicap_estimated boolean not null default false,
  position smallint not null check (position between 1 and 8),
  side smallint check (side in (1, 2)),
  unique (round_id, position)
);

create unique index live_round_players_member_once_idx
  on public.live_round_players (round_id, member_id) where member_id is not null;
create index live_round_players_member_idx
  on public.live_round_players (member_id) where member_id is not null;

create table public.live_round_holes (
  round_id bigint not null references public.live_rounds (id) on delete cascade,
  hole smallint not null check (hole between 1 and 18),
  par smallint not null check (par between 3 and 6),
  stroke_index smallint check (stroke_index is null or stroke_index between 1 and 18),
  primary key (round_id, hole)
);

create table public.live_round_scores (
  player_id bigint not null references public.live_round_players (id) on delete cascade,
  hole smallint not null check (hole between 1 and 18),
  round_id bigint not null references public.live_rounds (id) on delete cascade,
  strokes smallint check (strokes is null or strokes between 1 and 20),
  entered_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (player_id, hole)
);

create index live_round_scores_round_idx on public.live_round_scores (round_id);

comment on table public.live_rounds is 'Live scoring: a round being scored in the app. Points and positions are computed from the rows, never stored. Written only via live_round_* functions.';
comment on table public.live_round_players is 'Live scoring: up to 8 players, members or named guests, with the index they entered and the handicaps derived from it.';
comment on table public.live_round_holes is 'Live scoring: the round''s own copy of the card (par, stroke index), entered by the scorer where the course has none on file.';
comment on column public.live_round_scores.strokes is 'NULL = picked up (0 Stableford points; loses the hole in matchplay).';

-- ---------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------

create or replace function public.can_view_live_round(p_round_id bigint)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select (select auth.uid()) is not null
     and exists (
       select 1
         from public.live_rounds r
        where r.id = p_round_id
          and (
            r.created_by = (select auth.uid())
            or exists (
              select 1 from public.live_round_players p
               where p.round_id = r.id and p.member_id = (select auth.uid())
            )
          )
     );
$$;

revoke all on function public.can_view_live_round(bigint) from public;
revoke execute on function public.can_view_live_round(bigint) from anon;
grant execute on function public.can_view_live_round(bigint) to authenticated;

alter table public.live_rounds enable row level security;
alter table public.live_round_players enable row level security;
alter table public.live_round_holes enable row level security;
alter table public.live_round_scores enable row level security;

create policy "Players read their live rounds" on public.live_rounds
  for select to authenticated using (public.can_view_live_round(id));
create policy "Players read their live round's players" on public.live_round_players
  for select to authenticated using (public.can_view_live_round(round_id));
create policy "Players read their live round's card" on public.live_round_holes
  for select to authenticated using (public.can_view_live_round(round_id));
create policy "Players read their live round's scores" on public.live_round_scores
  for select to authenticated using (public.can_view_live_round(round_id));

-- No write policies on purpose; and no write grants either, so a missing
-- policy is never the only thing standing between a client and the table.
revoke insert, update, delete on public.live_rounds, public.live_round_players,
  public.live_round_holes, public.live_round_scores from anon, authenticated;
revoke all on public.live_rounds, public.live_round_players,
  public.live_round_holes, public.live_round_scores from anon;

-- ---------------------------------------------------------------------------
-- Deleted members lose their name on old leaderboards
-- ---------------------------------------------------------------------------

create or replace function public.live_round_player_forget_name()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.member_id is not null and new.member_id is null then
    new.display_name := 'Former member';
  end if;
  return new;
end;
$$;

create trigger live_round_players_forget_name
  before update of member_id on public.live_round_players
  for each row execute function public.live_round_player_forget_name();

-- ---------------------------------------------------------------------------
-- Live pings
-- ---------------------------------------------------------------------------

create or replace function public.realtime_live_round_id(topic text)
returns bigint
language sql
immutable
parallel safe
as $$
  select case
    when topic ~ '^live-round-[0-9]{1,18}$' then substring(topic from 12)::bigint
    else null
  end;
$$;

revoke all on function public.realtime_live_round_id(text) from public;
grant execute on function public.realtime_live_round_id(text) to authenticated;

drop policy if exists "Players receive their live round broadcasts" on realtime.messages;
create policy "Players receive their live round broadcasts"
on realtime.messages
for select
to authenticated
using (
  extension = 'broadcast'
  and public.realtime_live_round_id(topic) is not null
  and public.can_view_live_round(public.realtime_live_round_id(topic))
);

create or replace function public.live_round_broadcast()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_round bigint := case when tg_op = 'DELETE' then old.round_id else new.round_id end;
begin
  begin
    perform realtime.send(
      jsonb_build_object('round_id', v_round, 'table', tg_table_name),
      'changed',
      'live-round-' || v_round,
      true
    );
  exception when others then
    -- The write is what matters; a missed ping costs one refresh.
    null;
  end;
  return null;
end;
$$;

create trigger live_round_scores_broadcast
  after insert or update or delete on public.live_round_scores
  for each row execute function public.live_round_broadcast();
create trigger live_round_holes_broadcast
  after insert or update on public.live_round_holes
  for each row execute function public.live_round_broadcast();

-- live_rounds has no round_id column; finishing a round pings through here.
create or replace function public.live_round_status_broadcast()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    perform realtime.send(jsonb_build_object('round_id', new.id, 'table', 'live_rounds'), 'changed', 'live-round-' || new.id, true);
  exception when others then
    null;
  end;
  return null;
end;
$$;

create trigger live_rounds_status_broadcast
  after update of status on public.live_rounds
  for each row execute function public.live_round_status_broadcast();

-- ---------------------------------------------------------------------------
-- Writes
-- ---------------------------------------------------------------------------

-- Starting a round. One call, so a round never exists without its players
-- and its card.
--
-- p_round:   {course_name, club_id?, tee_name?, format, holes, course_rating?,
--             slope?, par_total?, allowance}
-- p_players: [{member_id?, name, handicap_index, course_handicap,
--             playing_handicap, handicap_estimated, side?}]  in playing order
-- p_card:    [{hole, par, stroke_index?}] one per hole
create or replace function public.live_round_create(p_round jsonb, p_players jsonb, p_card jsonb)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_round_id bigint;
  v_holes smallint := coalesce((p_round ->> 'holes')::smallint, 18);
  v_format text := p_round ->> 'format';
  v_player jsonb;
  v_member uuid;
  v_pos smallint := 0;
begin
  if v_me is null or not exists (select 1 from public.profiles where id = v_me and deleted_at is null) then
    raise exception 'Sign in to start a round' using errcode = '42501';
  end if;

  -- A ceiling, not a feature: nobody needs more than a few rounds live at once.
  if (select count(*) from public.live_rounds where created_by = v_me and status = 'live') >= 5 then
    raise exception 'You already have 5 rounds in play. Finish one first.' using errcode = 'P0001';
  end if;

  if jsonb_typeof(p_players) <> 'array' or jsonb_array_length(p_players) not between 1 and 8 then
    raise exception 'A round needs between 1 and 8 players' using errcode = '22023';
  end if;
  if v_format = 'matchplay' and jsonb_array_length(p_players) <> 2 then
    raise exception 'Singles matchplay is two players' using errcode = '22023';
  end if;
  if jsonb_typeof(p_card) <> 'array' or jsonb_array_length(p_card) <> v_holes
     or (select count(distinct (h ->> 'hole')::int) from jsonb_array_elements(p_card) h
          where (h ->> 'hole')::int between 1 and v_holes) <> v_holes then
    raise exception 'The card must have one entry for each hole' using errcode = '22023';
  end if;

  -- Members on the card: yourself or your accepted PinPals, nobody blocked,
  -- nobody twice.
  for v_player in select * from jsonb_array_elements(p_players) loop
    v_member := nullif(v_player ->> 'member_id', '')::uuid;
    if v_member is not null and v_member <> v_me then
      if not exists (select 1 from public.profiles where id = v_member and deleted_at is null)
         or public.is_blocked(v_me, v_member)
         or not exists (
           select 1 from public.connections c
            where c.status = 'accepted'
              and least(c.requester_id, c.recipient_id) = least(v_me, v_member)
              and greatest(c.requester_id, c.recipient_id) = greatest(v_me, v_member)
         ) then
        raise exception 'You can add yourself, your PinPals, or guests by name' using errcode = '42501';
      end if;
    end if;
  end loop;

  insert into public.live_rounds (created_by, club_id, course_name, tee_name, format, holes,
                                  course_rating, slope, par_total, allowance)
  values (
    v_me,
    nullif(p_round ->> 'club_id', '')::bigint,
    btrim(p_round ->> 'course_name'),
    nullif(btrim(coalesce(p_round ->> 'tee_name', '')), ''),
    v_format,
    v_holes,
    nullif(p_round ->> 'course_rating', '')::numeric,
    nullif(p_round ->> 'slope', '')::smallint,
    nullif(p_round ->> 'par_total', '')::smallint,
    (p_round ->> 'allowance')::numeric
  )
  returning id into v_round_id;

  for v_player in select * from jsonb_array_elements(p_players) loop
    v_pos := v_pos + 1;
    insert into public.live_round_players (round_id, member_id, display_name, handicap_index,
                                           course_handicap, playing_handicap, handicap_estimated,
                                           position, side)
    values (
      v_round_id,
      nullif(v_player ->> 'member_id', '')::uuid,
      btrim(v_player ->> 'name'),
      (v_player ->> 'handicap_index')::numeric,
      (v_player ->> 'course_handicap')::smallint,
      (v_player ->> 'playing_handicap')::smallint,
      coalesce((v_player ->> 'handicap_estimated')::boolean, false),
      v_pos,
      case when v_format = 'matchplay' then v_pos else nullif(v_player ->> 'side', '')::smallint end
    );
  end loop;

  insert into public.live_round_holes (round_id, hole, par, stroke_index)
  select v_round_id, (h ->> 'hole')::smallint, (h ->> 'par')::smallint, nullif(h ->> 'stroke_index', '')::smallint
    from jsonb_array_elements(p_card) h;

  return v_round_id;
end;
$$;

-- A score for one player on one hole. p_strokes null = picked up;
-- p_clear true removes the entry (a mis-tap on the wrong hole).
create or replace function public.live_round_set_score(
  p_round_id bigint,
  p_player_id bigint,
  p_hole smallint,
  p_strokes smallint,
  p_clear boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.can_view_live_round(p_round_id) then
    raise exception 'Not your round' using errcode = '42501';
  end if;
  if not exists (select 1 from public.live_rounds where id = p_round_id and status = 'live') then
    raise exception 'This round has finished' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.live_round_players where id = p_player_id and round_id = p_round_id) then
    raise exception 'That player is not in this round' using errcode = '22023';
  end if;
  if not exists (select 1 from public.live_round_holes where round_id = p_round_id and hole = p_hole) then
    raise exception 'No such hole in this round' using errcode = '22023';
  end if;

  if p_clear then
    delete from public.live_round_scores where player_id = p_player_id and hole = p_hole;
  else
    insert into public.live_round_scores (player_id, hole, round_id, strokes, entered_by)
    values (p_player_id, p_hole, p_round_id, p_strokes, (select auth.uid()))
    on conflict (player_id, hole) do update
      set strokes = excluded.strokes, entered_by = excluded.entered_by, updated_at = now();
  end if;
end;
$$;

-- Correcting the card: par and stroke index for one hole.
create or replace function public.live_round_set_hole(
  p_round_id bigint,
  p_hole smallint,
  p_par smallint,
  p_stroke_index smallint
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.can_view_live_round(p_round_id) then
    raise exception 'Not your round' using errcode = '42501';
  end if;
  if not exists (select 1 from public.live_rounds where id = p_round_id and status = 'live') then
    raise exception 'This round has finished' using errcode = 'P0001';
  end if;
  update public.live_round_holes
     set par = p_par, stroke_index = p_stroke_index
   where round_id = p_round_id and hole = p_hole;
  if not found then
    raise exception 'No such hole in this round' using errcode = '22023';
  end if;
end;
$$;

create or replace function public.live_round_finish(p_round_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.can_view_live_round(p_round_id) then
    raise exception 'Not your round' using errcode = '42501';
  end if;
  update public.live_rounds
     set status = 'finished', finished_at = now()
   where id = p_round_id and status = 'live';
end;
$$;

revoke all on function public.live_round_create(jsonb, jsonb, jsonb) from public;
revoke all on function public.live_round_set_score(bigint, bigint, smallint, smallint, boolean) from public;
revoke all on function public.live_round_set_hole(bigint, smallint, smallint, smallint) from public;
revoke all on function public.live_round_finish(bigint) from public;
revoke execute on function public.live_round_create(jsonb, jsonb, jsonb) from anon;
revoke execute on function public.live_round_set_score(bigint, bigint, smallint, smallint, boolean) from anon;
revoke execute on function public.live_round_set_hole(bigint, smallint, smallint, smallint) from anon;
revoke execute on function public.live_round_finish(bigint) from anon;
grant execute on function public.live_round_create(jsonb, jsonb, jsonb) to authenticated;
grant execute on function public.live_round_set_score(bigint, bigint, smallint, smallint, boolean) to authenticated;
grant execute on function public.live_round_set_hole(bigint, smallint, smallint, smallint) to authenticated;
grant execute on function public.live_round_finish(bigint) to authenticated;

revoke all on function public.live_round_broadcast() from public, anon, authenticated;
revoke all on function public.live_round_status_broadcast() from public, anon, authenticated;
revoke all on function public.live_round_player_forget_name() from public, anon, authenticated;
