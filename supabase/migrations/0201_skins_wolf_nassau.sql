-- 0201 — Side games: Skins, Wolf and Nassau (30 Oct 2026, claude/side-games.md)
--
-- Asked by Eire, 30 Oct 2026 (canvas "PinPals Next Ideas", row 2, "build
-- it"). Three more games beside 0196's Best Front 9 / Back 9 / Overall and
-- Sixes, scored the same way — Stableford points from each player's own
-- handicap — and settled the same way (PinPals keeps the tally only):
--
--   Skins   win a hole outright and it's your skin, worth the amount from
--           each other player. Ties carry the skin to the next hole, or are
--           void, as the group chooses.
--   Wolf    four players. Each hole has a Wolf, in turn by playing order;
--           after the drives the Wolf takes a partner (better ball, two v
--           two) or goes Lone Wolf, one v three for double. Picks are kept
--           in live_round_wolf_picks.
--   Nassau  every two players: front 9, back 9 and the 18 as three bets,
--           with an automatic press (a new bet to the end of that nine) for
--           whoever goes two down.
--
-- The scoring is on the phone (lib/side-games-extra.ts); only the set-up and
-- the Wolf's picks are stored. Money still needs every member playing to say
-- "I'm in", is still refused with a member under 18, and changing any game
-- or amount still clears the agreements.
--
-- One check is dropped and added again: "at least one game" now counts the
-- new ones.
--
-- Rollback: delete rows that use only the new games, put 0196's check back,
--   drop function if exists public.live_round_wolf_pick(bigint, smallint, bigint);
--   drop table if exists public.live_round_wolf_picks;
--   alter table public.live_round_side_games drop column skins, drop column wolf, drop column nassau,
--     drop column stake_skins, drop column stake_wolf, drop column stake_nassau;
--   and recreate live_round_set_side_games from 0196.

alter table public.live_round_side_games
  add column if not exists skins text check (skins is null or skins in ('carry', 'void')),
  add column if not exists wolf boolean not null default false,
  add column if not exists nassau boolean not null default false,
  add column if not exists stake_skins integer not null default 0 check (stake_skins between 0 and 50000),
  add column if not exists stake_wolf integer not null default 0 check (stake_wolf between 0 and 50000),
  add column if not exists stake_nassau integer not null default 0 check (stake_nassau between 0 and 50000);

alter table public.live_round_side_games drop constraint if exists live_round_side_games_check;
alter table public.live_round_side_games add constraint live_round_side_games_check
  check (best_front or best_back or best_overall or sixes is not null or skins is not null or wolf or nassau);

comment on column public.live_round_side_games.skins is 'Skins (0201): null = off; carry = a tied hole carries its skin on; void = a tied hole''s skin is lost.';
comment on column public.live_round_side_games.stake_wolf is 'Wolf (0201): cents a point. A pair''s win is a point from each loser; a Lone Wolf''s is two from each.';

-- The Wolf's choice on each hole: a partner, or alone (partner null).
create table if not exists public.live_round_wolf_picks (
  id bigint generated always as identity primary key,
  round_id bigint not null references public.live_rounds (id) on delete cascade,
  hole smallint not null check (hole between 1 and 18),
  wolf_player_id bigint not null references public.live_round_players (id) on delete cascade,
  partner_player_id bigint references public.live_round_players (id) on delete cascade,
  picked_by uuid references public.profiles (id) on delete set null,
  picked_at timestamptz not null default now(),
  constraint live_round_wolf_picks_hole_key unique (round_id, hole),
  check (partner_player_id is null or partner_player_id <> wolf_player_id)
);
create index if not exists live_round_wolf_picks_wolf_idx on public.live_round_wolf_picks (wolf_player_id);
create index if not exists live_round_wolf_picks_partner_idx on public.live_round_wolf_picks (partner_player_id);

comment on table public.live_round_wolf_picks is 'Wolf (0201): the Wolf''s partner on each hole, or none for a Lone Wolf. Written only through live_round_wolf_pick().';

alter table public.live_round_wolf_picks enable row level security;
revoke all on public.live_round_wolf_picks from anon;
revoke insert, update, delete, truncate, references, trigger on public.live_round_wolf_picks from authenticated;
grant select on public.live_round_wolf_picks to authenticated;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'live_round_wolf_picks' and policyname = 'Wolf picks: whoever can see the round') then
    create policy "Wolf picks: whoever can see the round" on public.live_round_wolf_picks
      for select to authenticated using (public.can_view_live_round(round_id));
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'live_round_wolf_picks_broadcast') then
    create trigger live_round_wolf_picks_broadcast
      after insert or update or delete on public.live_round_wolf_picks
      for each row execute function public.live_round_broadcast();
  end if;
end $$;

-- p_games: 0196's fields, plus
--   skins: null | "carry" | "void", wolf: boolean, nassau: boolean,
--   stake_skins (a skin), stake_wolf (a point), stake_nassau (a bet): cents
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
  v_skins text;
  v_wolf boolean;
  v_nassau boolean;
  v_mode text;
  v_money boolean;
  s_front integer;
  s_back integer;
  s_overall integer;
  s_sixes integer;
  s_skins integer;
  s_wolf integer;
  s_nassau integer;
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
    delete from public.live_round_wolf_picks where round_id = p_round_id;
    return;
  end if;
  if jsonb_typeof(p_games) <> 'object' then
    raise exception 'Those side games don''t make sense' using errcode = '22023';
  end if;

  v_front := coalesce((p_games ->> 'best_front')::boolean, false);
  v_back := coalesce((p_games ->> 'best_back')::boolean, false);
  v_overall := coalesce((p_games ->> 'best_overall')::boolean, false);
  v_sixes := nullif(p_games ->> 'sixes', '');
  v_skins := nullif(p_games ->> 'skins', '');
  v_wolf := coalesce((p_games ->> 'wolf')::boolean, false);
  v_nassau := coalesce((p_games ->> 'nassau')::boolean, false);
  v_mode := coalesce(nullif(p_games ->> 'mode', ''), 'pride');
  if v_sixes is not null and v_sixes not in ('individual', 'pairs') then
    raise exception 'Sixes is played individually or in pairs' using errcode = '22023';
  end if;
  if v_skins is not null and v_skins not in ('carry', 'void') then
    raise exception 'Tied skins carry over or are void' using errcode = '22023';
  end if;
  if v_mode not in ('pride', 'points', 'money') then
    raise exception 'Play for bragging rights, points or money' using errcode = '22023';
  end if;
  if not (v_front or v_back or v_overall or v_sixes is not null or v_skins is not null or v_wolf or v_nassau) then
    raise exception 'Pick at least one side game' using errcode = '22023';
  end if;
  select count(*) into n from public.live_round_players where round_id = p_round_id;
  if v_sixes = 'pairs' and n <> 4 then
    raise exception 'Sixes in pairs needs exactly four players' using errcode = 'P0001';
  end if;
  if v_wolf and n <> 4 then
    raise exception 'Wolf needs exactly four players' using errcode = 'P0001';
  end if;

  v_money := v_mode = 'money';
  s_front := case when v_money and v_front then coalesce((p_games ->> 'stake_front')::integer, 0) else 0 end;
  s_back := case when v_money and v_back then coalesce((p_games ->> 'stake_back')::integer, 0) else 0 end;
  s_overall := case when v_money and v_overall then coalesce((p_games ->> 'stake_overall')::integer, 0) else 0 end;
  s_sixes := case when v_money and v_sixes is not null then coalesce((p_games ->> 'stake_sixes')::integer, 0) else 0 end;
  s_skins := case when v_money and v_skins is not null then coalesce((p_games ->> 'stake_skins')::integer, 0) else 0 end;
  s_wolf := case when v_money and v_wolf then coalesce((p_games ->> 'stake_wolf')::integer, 0) else 0 end;
  s_nassau := case when v_money and v_nassau then coalesce((p_games ->> 'stake_nassau')::integer, 0) else 0 end;
  if least(s_front, s_back, s_overall, s_sixes, s_skins, s_wolf, s_nassau) < 0
     or greatest(s_front, s_back, s_overall, s_sixes, s_skins, s_wolf, s_nassau) > 50000 then
    raise exception 'Keep each game between €0 and €500' using errcode = '22023';
  end if;
  if v_money and s_front + s_back + s_overall + s_sixes + s_skins + s_wolf + s_nassau = 0 then
    raise exception 'Put in an amount to play for money' using errcode = '22023';
  end if;
  if v_money and public.live_has_minor(null, p_round_id) then
    raise exception 'Side games can''t be played for money with a member under 18 in the round' using errcode = 'P0001';
  end if;

  select * into v_old from public.live_round_side_games where round_id = p_round_id;

  insert into public.live_round_side_games (round_id, best_front, best_back, best_overall, sixes, skins, wolf, nassau, mode,
    stake_front, stake_back, stake_overall, stake_sixes, stake_skins, stake_wolf, stake_nassau, set_by, updated_at)
  values (p_round_id, v_front, v_back, v_overall, v_sixes, v_skins, v_wolf, v_nassau, v_mode,
    s_front, s_back, s_overall, s_sixes, s_skins, s_wolf, s_nassau, me, now())
  on conflict (round_id) do update set
    best_front = excluded.best_front, best_back = excluded.best_back, best_overall = excluded.best_overall,
    sixes = excluded.sixes, skins = excluded.skins, wolf = excluded.wolf, nassau = excluded.nassau, mode = excluded.mode,
    stake_front = excluded.stake_front, stake_back = excluded.stake_back,
    stake_overall = excluded.stake_overall, stake_sixes = excluded.stake_sixes,
    stake_skins = excluded.stake_skins, stake_wolf = excluded.stake_wolf, stake_nassau = excluded.stake_nassau,
    set_by = excluded.set_by, updated_at = now();

  if not v_wolf then
    delete from public.live_round_wolf_picks where round_id = p_round_id;
  end if;

  -- Anything that changes what's being played for clears the agreements.
  if v_old.round_id is null
     or v_old.best_front is distinct from v_front or v_old.best_back is distinct from v_back
     or v_old.best_overall is distinct from v_overall or v_old.sixes is distinct from v_sixes
     or v_old.skins is distinct from v_skins or v_old.wolf is distinct from v_wolf or v_old.nassau is distinct from v_nassau
     or v_old.mode is distinct from v_mode
     or v_old.stake_front <> s_front or v_old.stake_back <> s_back
     or v_old.stake_overall <> s_overall or v_old.stake_sixes <> s_sixes
     or v_old.stake_skins <> s_skins or v_old.stake_wolf <> s_wolf or v_old.stake_nassau <> s_nassau then
    delete from public.live_round_side_game_agreements where round_id = p_round_id;
  end if;
  if v_money and exists (select 1 from public.live_round_players where round_id = p_round_id and member_id = me) then
    insert into public.live_round_side_game_agreements (round_id, member_id) values (p_round_id, me)
    on conflict do nothing;
  end if;
end;
$$;

revoke all on function public.live_round_set_side_games(bigint, jsonb) from public, anon, authenticated;
grant execute on function public.live_round_set_side_games(bigint, jsonb) to authenticated;

-- The Wolf's pick on a hole: a partner's player id, or null to go alone.
-- Any member playing, or whoever started the round (they hold the guests'
-- phones), while the round is live. The Wolf is the hole's player in turn
-- by playing order: hole 1 the first, hole 2 the second, and round again.
create or replace function public.live_round_wolf_pick(p_round_id bigint, p_hole smallint, p_partner bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := (select auth.uid());
  r public.live_rounds;
  v_wolf bigint;
begin
  if me is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  select * into r from public.live_rounds where id = p_round_id;
  if not found then
    raise exception 'That round isn''t there any more' using errcode = 'P0002';
  end if;
  if r.created_by is distinct from me
     and not exists (select 1 from public.live_round_players where round_id = p_round_id and member_id = me) then
    raise exception 'Only the players can pick for the Wolf' using errcode = '42501';
  end if;
  if r.status <> 'live' then
    raise exception 'This round has finished' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.live_round_side_games where round_id = p_round_id and wolf) then
    raise exception 'Wolf isn''t being played on this round' using errcode = 'P0001';
  end if;
  if p_hole is null or p_hole not between 1 and 18 then
    raise exception 'Which hole?' using errcode = '22023';
  end if;
  select id into v_wolf
    from public.live_round_players
   where round_id = p_round_id
   order by position, id
  offset ((p_hole - 1) % 4) limit 1;
  if p_partner is not null and (p_partner = v_wolf
       or not exists (select 1 from public.live_round_players where id = p_partner and round_id = p_round_id)) then
    raise exception 'Pick one of the other three' using errcode = '22023';
  end if;
  insert into public.live_round_wolf_picks (round_id, hole, wolf_player_id, partner_player_id, picked_by, picked_at)
  values (p_round_id, p_hole, v_wolf, p_partner, me, now())
  on conflict (round_id, hole) do update
    set wolf_player_id = excluded.wolf_player_id, partner_player_id = excluded.partner_player_id,
        picked_by = excluded.picked_by, picked_at = now();
end;
$$;

revoke all on function public.live_round_wolf_pick(bigint, smallint, bigint) from public, anon, authenticated;
grant execute on function public.live_round_wolf_pick(bigint, smallint, bigint) to authenticated;
