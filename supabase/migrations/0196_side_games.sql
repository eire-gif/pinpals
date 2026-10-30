-- 0196 — Side games alongside the main score (Oct 2026, claude/side-games.md)
--
-- Asked by Eire, 30 Oct 2026 (canvas "PinPals Engagement Features", row 1,
-- approved): side games that run alongside a round's main game — Best
-- Front 9, Best Back 9, Best Overall, and Sixes (three 6-hole matches),
-- either individually or in pairs that rotate so you partner everyone once.
-- The group plays for bragging rights, points or money, with an amount they
-- type in; at the end the app shows who owes whom in the fewest payments.
--
-- PinPals only KEEPS THE TALLY. No money moves through PinPals: players pay
-- each other by Revolut or cash and tick "paid". Nothing here takes a cut.
--
-- 1. live_round_side_games — one row per round: which games, the mode and
--    the amount per game (cents). Set by whoever started the round, while
--    it's live, on an 18-hole round where everyone has their own ball
--    (not scramble, foursomes or greensomes, not a match-day match).
--    Sixes in pairs needs exactly four players.
-- 2. Money is refused while any member playing is under 18 (0159), and
--    each member playing agrees to it on their own phone
--    (live_round_side_game_agreements). Changing the games or the amount
--    clears the agreements, so nobody is held to a stake they didn't see.
-- 3. live_round_side_game_payments — "paid" ticks on the settle-up. Who
--    owes what is worked out in the app (lib/side-games.ts), never stored;
--    a tick records the pair and the amount it was for.
--
-- All three are read by anyone who can see the round (can_view_live_round)
-- and written only through the functions below. Changes ping the round's
-- realtime channel (live_round_broadcast) so every phone re-fetches.
--
-- Rollback:
--   drop function if exists public.live_round_side_game_paid(bigint, bigint, bigint, integer, boolean),
--     public.live_round_side_games_agree(bigint, boolean),
--     public.live_round_set_side_games(bigint, jsonb), public.live_round_side_games_error(bigint, uuid);
--   drop table if exists public.live_round_side_game_payments,
--     public.live_round_side_game_agreements, public.live_round_side_games;

-- ===========================================================================
-- 1. Tables
-- ===========================================================================

create table if not exists public.live_round_side_games (
  round_id bigint primary key references public.live_rounds (id) on delete cascade,
  best_front boolean not null default false,
  best_back boolean not null default false,
  best_overall boolean not null default false,
  sixes text check (sixes is null or sixes in ('individual', 'pairs')),
  mode text not null default 'pride' check (mode in ('pride', 'points', 'money')),
  -- Amounts per game in cents (money mode). 0 when the game isn't on or
  -- the mode isn't money. €500 a game is far past any friendly stake.
  stake_front integer not null default 0 check (stake_front between 0 and 50000),
  stake_back integer not null default 0 check (stake_back between 0 and 50000),
  stake_overall integer not null default 0 check (stake_overall between 0 and 50000),
  stake_sixes integer not null default 0 check (stake_sixes between 0 and 50000),
  set_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  check (best_front or best_back or best_overall or sixes is not null)
);

comment on table public.live_round_side_games is
  'Side games on a live round (0196): which games, the mode and the amount per game in cents. PinPals keeps the tally only; no money moves through it.';

create table if not exists public.live_round_side_game_agreements (
  round_id bigint not null references public.live_rounds (id) on delete cascade,
  member_id uuid not null references public.profiles (id) on delete cascade,
  agreed_at timestamptz not null default now(),
  primary key (round_id, member_id)
);

comment on table public.live_round_side_game_agreements is
  'A member playing in the round agreed to the money side games as they stood (0196). Cleared whenever the games or amounts change.';

create table if not exists public.live_round_side_game_payments (
  round_id bigint not null references public.live_rounds (id) on delete cascade,
  from_player_id bigint not null references public.live_round_players (id) on delete cascade,
  to_player_id bigint not null references public.live_round_players (id) on delete cascade,
  amount_cents integer not null check (amount_cents between 1 and 1000000),
  marked_by uuid references public.profiles (id) on delete set null,
  paid_at timestamptz not null default now(),
  primary key (round_id, from_player_id, to_player_id),
  check (from_player_id <> to_player_id)
);

comment on table public.live_round_side_game_payments is
  'A settle-up payment ticked as paid (0196). The amounts owed are worked out in the app from the scores; this only records the tick.';

create index if not exists live_round_side_game_agreements_member_idx
  on public.live_round_side_game_agreements (member_id);
create index if not exists live_round_side_game_payments_to_idx
  on public.live_round_side_game_payments (to_player_id);
create index if not exists live_round_side_game_payments_from_idx
  on public.live_round_side_game_payments (from_player_id);

alter table public.live_round_side_games enable row level security;
alter table public.live_round_side_game_agreements enable row level security;
alter table public.live_round_side_game_payments enable row level security;

revoke all on public.live_round_side_games, public.live_round_side_game_agreements,
  public.live_round_side_game_payments from anon;
revoke insert, update, delete, truncate, references, trigger on public.live_round_side_games,
  public.live_round_side_game_agreements, public.live_round_side_game_payments from authenticated;
grant select on public.live_round_side_games, public.live_round_side_game_agreements,
  public.live_round_side_game_payments to authenticated;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'live_round_side_games' and policyname = 'Side games: whoever can see the round') then
    create policy "Side games: whoever can see the round" on public.live_round_side_games
      for select to authenticated using (public.can_view_live_round(round_id));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'live_round_side_game_agreements' and policyname = 'Side game agreements: whoever can see the round') then
    create policy "Side game agreements: whoever can see the round" on public.live_round_side_game_agreements
      for select to authenticated using (public.can_view_live_round(round_id));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'live_round_side_game_payments' and policyname = 'Side game payments: whoever can see the round') then
    create policy "Side game payments: whoever can see the round" on public.live_round_side_game_payments
      for select to authenticated using (public.can_view_live_round(round_id));
  end if;
end $$;

-- Every phone on the round re-fetches when any of these change.
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'live_round_side_games_broadcast') then
    create trigger live_round_side_games_broadcast
      after insert or update or delete on public.live_round_side_games
      for each row execute function public.live_round_broadcast();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'live_round_side_game_agreements_broadcast') then
    create trigger live_round_side_game_agreements_broadcast
      after insert or update or delete on public.live_round_side_game_agreements
      for each row execute function public.live_round_broadcast();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'live_round_side_game_payments_broadcast') then
    create trigger live_round_side_game_payments_broadcast
      after insert or update or delete on public.live_round_side_game_payments
      for each row execute function public.live_round_broadcast();
  end if;
end $$;

-- ===========================================================================
-- 2. Setting them up
-- ===========================================================================

-- Why side games can't go on this round (null = they can). Internal.
create or replace function public.live_round_side_games_error(p_round_id bigint, p_me uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  r public.live_rounds;
  n integer;
begin
  select * into r from public.live_rounds where id = p_round_id;
  if not found then
    return 'That round isn''t there any more.';
  end if;
  if r.created_by is distinct from p_me then
    return 'Only whoever started the round can set up side games.';
  end if;
  if r.status <> 'live' then
    return 'This round has finished.';
  end if;
  if r.holes <> 18 then
    return 'Side games need an 18-hole round.';
  end if;
  if r.match_day_id is not null or r.scramble_size is not null or r.format in ('scramble', 'foursomes', 'greensomes') then
    return 'Side games need everyone playing their own ball.';
  end if;
  select count(*) into n from public.live_round_players where round_id = p_round_id;
  if n < 2 then
    return 'Side games need at least two players.';
  end if;
  return null;
end;
$$;

revoke all on function public.live_round_side_games_error(bigint, uuid) from public, anon, authenticated;

-- p_games: {best_front, best_back, best_overall: boolean,
--           sixes: null | "individual" | "pairs",
--           mode: "pride" | "points" | "money",
--           stake_front, stake_back, stake_overall, stake_sixes: cents}
-- Null p_games turns side games off for the round.
create or replace function public.live_round_set_side_games(p_round_id bigint, p_games jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := (select auth.uid());
  v_err text;
  v_front boolean;
  v_back boolean;
  v_overall boolean;
  v_sixes text;
  v_mode text;
  v_money boolean;
  s_front integer;
  s_back integer;
  s_overall integer;
  s_sixes integer;
  v_old public.live_round_side_games;
  n integer;
begin
  if me is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  v_err := public.live_round_side_games_error(p_round_id, me);
  if v_err is not null then
    raise exception '%', v_err using errcode = case when v_err like 'Only%' then '42501' else 'P0001' end;
  end if;

  if p_games is null or jsonb_typeof(p_games) = 'null' then
    delete from public.live_round_side_games where round_id = p_round_id;
    delete from public.live_round_side_game_agreements where round_id = p_round_id;
    return;
  end if;
  if jsonb_typeof(p_games) <> 'object' then
    raise exception 'Those side games don''t make sense' using errcode = '22023';
  end if;

  v_front := coalesce((p_games ->> 'best_front')::boolean, false);
  v_back := coalesce((p_games ->> 'best_back')::boolean, false);
  v_overall := coalesce((p_games ->> 'best_overall')::boolean, false);
  v_sixes := nullif(p_games ->> 'sixes', '');
  v_mode := coalesce(nullif(p_games ->> 'mode', ''), 'pride');
  if v_sixes is not null and v_sixes not in ('individual', 'pairs') then
    raise exception 'Sixes is played individually or in pairs' using errcode = '22023';
  end if;
  if v_mode not in ('pride', 'points', 'money') then
    raise exception 'Play for bragging rights, points or money' using errcode = '22023';
  end if;
  if not (v_front or v_back or v_overall or v_sixes is not null) then
    raise exception 'Pick at least one side game' using errcode = '22023';
  end if;
  if v_sixes = 'pairs' then
    select count(*) into n from public.live_round_players where round_id = p_round_id;
    if n <> 4 then
      raise exception 'Sixes in pairs needs exactly four players' using errcode = 'P0001';
    end if;
  end if;

  v_money := v_mode = 'money';
  s_front := case when v_money and v_front then coalesce((p_games ->> 'stake_front')::integer, 0) else 0 end;
  s_back := case when v_money and v_back then coalesce((p_games ->> 'stake_back')::integer, 0) else 0 end;
  s_overall := case when v_money and v_overall then coalesce((p_games ->> 'stake_overall')::integer, 0) else 0 end;
  s_sixes := case when v_money and v_sixes is not null then coalesce((p_games ->> 'stake_sixes')::integer, 0) else 0 end;
  if least(s_front, s_back, s_overall, s_sixes) < 0 or greatest(s_front, s_back, s_overall, s_sixes) > 50000 then
    raise exception 'Keep each game between €0 and €500' using errcode = '22023';
  end if;
  if v_money and s_front + s_back + s_overall + s_sixes = 0 then
    raise exception 'Put in an amount to play for money' using errcode = '22023';
  end if;
  if v_money and public.live_has_minor(null, p_round_id) then
    raise exception 'Side games can''t be played for money with a member under 18 in the round' using errcode = 'P0001';
  end if;

  select * into v_old from public.live_round_side_games where round_id = p_round_id;

  insert into public.live_round_side_games (round_id, best_front, best_back, best_overall, sixes, mode,
    stake_front, stake_back, stake_overall, stake_sixes, set_by, updated_at)
  values (p_round_id, v_front, v_back, v_overall, v_sixes, v_mode, s_front, s_back, s_overall, s_sixes, me, now())
  on conflict (round_id) do update set
    best_front = excluded.best_front, best_back = excluded.best_back, best_overall = excluded.best_overall,
    sixes = excluded.sixes, mode = excluded.mode,
    stake_front = excluded.stake_front, stake_back = excluded.stake_back,
    stake_overall = excluded.stake_overall, stake_sixes = excluded.stake_sixes,
    set_by = excluded.set_by, updated_at = now();

  -- Anything that changes what's being played for clears the agreements.
  if v_old.round_id is null
     or v_old.best_front is distinct from v_front or v_old.best_back is distinct from v_back
     or v_old.best_overall is distinct from v_overall or v_old.sixes is distinct from v_sixes
     or v_old.mode is distinct from v_mode
     or v_old.stake_front <> s_front or v_old.stake_back <> s_back
     or v_old.stake_overall <> s_overall or v_old.stake_sixes <> s_sixes then
    delete from public.live_round_side_game_agreements where round_id = p_round_id;
  end if;
  -- Whoever set it up has agreed to it.
  if v_money and exists (select 1 from public.live_round_players where round_id = p_round_id and member_id = me) then
    insert into public.live_round_side_game_agreements (round_id, member_id) values (p_round_id, me)
    on conflict do nothing;
  end if;
end;
$$;

revoke all on function public.live_round_set_side_games(bigint, jsonb) from public, anon, authenticated;
grant execute on function public.live_round_set_side_games(bigint, jsonb) to authenticated;

-- A member playing in the round: "I'm in" (or out again).
create or replace function public.live_round_side_games_agree(p_round_id bigint, p_agree boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := (select auth.uid());
begin
  if me is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if not exists (select 1 from public.live_round_players where round_id = p_round_id and member_id = me) then
    raise exception 'Only players in the round can agree to its side games' using errcode = '42501';
  end if;
  if not exists (select 1 from public.live_round_side_games where round_id = p_round_id and mode = 'money') then
    raise exception 'There''s nothing to agree to on this round' using errcode = 'P0001';
  end if;
  if p_agree then
    if public.is_minor(me) then
      raise exception 'Members under 18 can''t play side games for money' using errcode = 'P0001';
    end if;
    insert into public.live_round_side_game_agreements (round_id, member_id) values (p_round_id, me)
    on conflict do nothing;
  else
    delete from public.live_round_side_game_agreements where round_id = p_round_id and member_id = me;
  end if;
end;
$$;

revoke all on function public.live_round_side_games_agree(bigint, boolean) from public, anon, authenticated;
grant execute on function public.live_round_side_games_agree(bigint, boolean) to authenticated;

-- ===========================================================================
-- 3. Settling up
-- ===========================================================================

-- Tick (or untick) a payment as paid. Either of the two players, if they're
-- members, or whoever started the round (they hold the guests' phones).
create or replace function public.live_round_side_game_paid(
  p_round_id bigint, p_from bigint, p_to bigint, p_amount_cents integer, p_paid boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := (select auth.uid());
  v_from uuid;
  v_to uuid;
  v_starter uuid;
begin
  if me is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  select created_by into v_starter from public.live_rounds where id = p_round_id;
  if not found then
    raise exception 'That round isn''t there any more' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.live_round_side_games where round_id = p_round_id and mode = 'money') then
    raise exception 'This round has no money side games' using errcode = 'P0001';
  end if;
  select member_id into v_from from public.live_round_players where id = p_from and round_id = p_round_id;
  if not found then
    raise exception 'That player isn''t in this round' using errcode = 'P0001';
  end if;
  select member_id into v_to from public.live_round_players where id = p_to and round_id = p_round_id;
  if not found then
    raise exception 'That player isn''t in this round' using errcode = 'P0001';
  end if;
  if me is distinct from v_from and me is distinct from v_to and me is distinct from v_starter then
    raise exception 'Only the two players, or whoever started the round, can tick this' using errcode = '42501';
  end if;
  if p_paid then
    if p_amount_cents is null or p_amount_cents < 1 or p_amount_cents > 1000000 then
      raise exception 'That amount doesn''t look right' using errcode = '22023';
    end if;
    insert into public.live_round_side_game_payments (round_id, from_player_id, to_player_id, amount_cents, marked_by, paid_at)
    values (p_round_id, p_from, p_to, p_amount_cents, me, now())
    on conflict (round_id, from_player_id, to_player_id) do update
      set amount_cents = excluded.amount_cents, marked_by = excluded.marked_by, paid_at = now();
  else
    delete from public.live_round_side_game_payments
     where round_id = p_round_id and from_player_id = p_from and to_player_id = p_to;
  end if;
end;
$$;

revoke all on function public.live_round_side_game_paid(bigint, bigint, bigint, integer, boolean) from public, anon, authenticated;
grant execute on function public.live_round_side_game_paid(bigint, bigint, bigint, integer, boolean) to authenticated;
