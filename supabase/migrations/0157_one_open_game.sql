-- 0157 — One open game at a time (Oct 2026, claude/one-open-game.md)
--
-- Two people on the same tee time could both tap Start live scoring and get
-- two separate games with the same four players in each. Now a PinPals
-- member can only be a player in ONE open game at a time:
--
--   * an open game = a live round (status 'live') started in the last
--     8 hours. Older ones that were never finished don't count, so a round
--     somebody forgot to finish doesn't block them tomorrow.
--   * every kind of game is covered — a round, a scramble, foursomes, a
--     match day, a group day — because every one of them puts its players in
--     live_round_players. A match day may put the same member in several of
--     its own matches (morning fourballs, afternoon singles); that's one game.
--   * guests by name (no member id) aren't checked: there is nothing to match.
--
-- When someone tries to start a second game with a member who's already in
-- one, the whole start is refused (nothing is created) with a message that
-- says whose game it is, and a hint the app reads to open that game instead:
--   hint = 'open-game:round:<id>'  or  'open-game:day:<id>'
--
-- RACES: two phones tapping Start at the same moment. Every start takes one
-- short transaction-level lock first (live_game_start_lock below), so the
-- second start waits for the first to finish, then sees its players and is
-- refused. Starting a game takes a few milliseconds, so the wait is nothing.
--
-- Additive: two new functions, two triggers and an index. Nothing existing is
-- redefined. No grants to members — the triggers run on their own.
--
-- ROLLBACK:
--   drop trigger if exists live_rounds_start_lock on public.live_rounds;
--   drop trigger if exists live_round_players_one_open_game on public.live_round_players;
--   drop function if exists public.live_game_start_lock();
--   drop function if exists public.live_round_players_one_open_game();
--   drop index if exists public.live_rounds_open_idx;

-- Finding a member's open rounds quickly.
create index if not exists live_rounds_open_idx
  on public.live_rounds (created_at desc) where status = 'live';

-- One lock for every game start. Taken before the round row goes in, so two
-- starts can't interleave their player inserts (and can't deadlock on each
-- other's players either: it's one lock, always first).
create or replace function public.live_game_start_lock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform pg_advisory_xact_lock(hashtext('pinpals:live-game-start'));
  return new;
end;
$$;
revoke all on function public.live_game_start_lock() from public, anon, authenticated;

drop trigger if exists live_rounds_start_lock on public.live_rounds;
create trigger live_rounds_start_lock
  before insert on public.live_rounds
  for each row execute function public.live_game_start_lock();

create or replace function public.live_round_players_one_open_game()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day bigint;
  v_other record;
  v_who text;
  v_starter text;
begin
  if new.member_id is null then
    return new;
  end if;

  -- Also covers a player added to a game that already exists.
  perform pg_advisory_xact_lock(hashtext('pinpals:live-game-start'));

  select match_day_id into v_day from public.live_rounds where id = new.round_id;

  select r.id, r.match_day_id, r.created_by
    into v_other
    from public.live_round_players p
    join public.live_rounds r on r.id = p.round_id
   where p.member_id = new.member_id
     and p.round_id <> new.round_id
     and r.status = 'live'
     and r.created_at > now() - interval '8 hours'
     -- The same match day is the same game.
     and (v_day is null or r.match_day_id is distinct from v_day)
   order by r.created_at desc
   limit 1;

  if v_other.id is null then
    return new;
  end if;

  v_who := coalesce(nullif(btrim(new.display_name), ''), 'A player');
  select nullif(btrim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')), '')
    into v_starter
    from public.profiles where id = v_other.created_by;

  raise exception using
    errcode = 'P0001',
    message = format(
      '%s is already in a game%s. Open that game instead — two games can''t be open for the same players.',
      v_who,
      case when v_starter is null then '' else format(' started by %s', v_starter) end
    ),
    hint = case
      when v_other.match_day_id is not null then format('open-game:day:%s', v_other.match_day_id)
      else format('open-game:round:%s', v_other.id)
    end;
end;
$$;
revoke all on function public.live_round_players_one_open_game() from public, anon, authenticated;

drop trigger if exists live_round_players_one_open_game on public.live_round_players;
create trigger live_round_players_one_open_game
  before insert on public.live_round_players
  for each row execute function public.live_round_players_one_open_game();

-- Where a member's open game is, for the app: their tee time page offers
-- "Open the live game" instead of "Start live scoring", and the new-game
-- screen sends them there before they set up a second one. Your own only.
create or replace function public.my_open_live_game()
returns table (kind text, id bigint, round_id bigint, started_by text, course_name text, created_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select case when r.match_day_id is null then 'round' else 'day' end,
         coalesce(r.match_day_id, r.id),
         r.id,
         nullif(btrim(coalesce(pr.first_name, '') || ' ' || coalesce(pr.last_name, '')), ''),
         r.course_name,
         r.created_at
    from public.live_round_players p
    join public.live_rounds r on r.id = p.round_id
    left join public.profiles pr on pr.id = r.created_by
   where p.member_id = (select auth.uid())
     and r.status = 'live'
     and r.created_at > now() - interval '8 hours'
   order by r.created_at desc
   limit 1;
$$;
revoke all on function public.my_open_live_game() from public, anon, authenticated;
grant execute on function public.my_open_live_game() to authenticated;
