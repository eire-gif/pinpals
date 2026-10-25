-- 0189 — Team handicaps set by hand (Oct 2026)
--
-- Asked by Eire, 25 Oct 2026: in a scramble (2s or 4s), foursomes or
-- greensomes — any game where a team plays off one handicap — the organiser
-- (or whoever set up the round) can set the team's handicap by hand for that
-- game. By default it is still worked out from each player's index, as now;
-- setting it by hand changes only that game, never a member's own handicap
-- or the society's figures.
--
-- Decisions (Eire, 25 Oct 2026):
--   * Who: the organiser of a day (live_day_organiser, 0174: whoever started
--     it, or the society event's officers); for a round on its own, whoever
--     set it up.
--   * When: before or during the round. Once a score is in, the team's
--     players are told (live_team_handicap notification); the app asks the
--     organiser to confirm first. Not once the round is finished.
--   * No reason is asked for.
--   * Open and fair: the worked-out figure is kept beside it
--     (team_handicap_auto), and everywhere the team is shown it reads
--     "set by hand", the way an amended result is marked "Amended".
--
-- Storage. team_handicap stays the one figure everything scores from
-- (boards, results, cards, the TV, 0138/0176/0180), so nothing downstream
-- changes. team_handicap_auto holds the worked-out figure while a hand-set
-- one is in force; null means the team plays off the worked-out figure.
-- Setting it back to the worked-out figure clears the mark.
--
-- Written only through live_round_set_team_handicap. The only drops are
-- "if exists" guards so the file can be re-run (its own check and trigger).
--
-- Applied to production 25 Oct 2026.
--
-- Rollback:
--   drop trigger if exists live_rounds_team_handicap_broadcast on public.live_rounds;
--   drop function if exists public.live_round_set_team_handicap(bigint, integer);
--   alter table public.live_rounds drop column if exists team_handicap_auto,
--     drop column if exists team_handicap_set_by, drop column if exists team_handicap_set_at;

alter table public.live_rounds
  add column if not exists team_handicap_auto smallint check (team_handicap_auto is null or team_handicap_auto between -20 and 80),
  add column if not exists team_handicap_set_by uuid references public.profiles (id) on delete set null,
  add column if not exists team_handicap_set_at timestamptz;

alter table public.live_rounds
  drop constraint if exists live_rounds_team_handicap_auto_team;
alter table public.live_rounds
  add constraint live_rounds_team_handicap_auto_team
  check (team_handicap_auto is null or scramble_size is not null);

comment on column public.live_rounds.team_handicap_auto is
  'Team handicap set by hand (0189): the worked-out figure while a hand-set team_handicap is in force; null = playing off the worked-out figure.';
comment on column public.live_rounds.team_handicap_set_by is 'Team handicap set by hand (0189): who set it.';
comment on column public.live_rounds.team_handicap_set_at is 'Team handicap set by hand (0189): when.';

-- Sets a team's handicap for this game, or puts it back to the worked-out
-- figure (pass that figure). Returns the figure now in force.
create or replace function public.live_round_set_team_handicap(p_round_id bigint, p_handicap integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := (select auth.uid());
  r public.live_rounds%rowtype;
  v_auto smallint;
  v_started boolean;
  v_label text;
  v_player record;
begin
  if me is null then raise exception 'Sign in first.' using errcode = '42501'; end if;

  select * into r from public.live_rounds where id = p_round_id for update;
  if not found then raise exception 'That round isn''t there any more.' using errcode = 'P0002'; end if;

  if r.match_day_id is not null then
    if not public.live_day_organiser(r.match_day_id, me) then
      raise exception 'Only the organiser can change a team''s handicap.' using errcode = '42501';
    end if;
  elsif r.created_by is distinct from me then
    raise exception 'Only whoever set up the round can change the team''s handicap.' using errcode = '42501';
  end if;

  if r.scramble_size is null or r.team_handicap is null then
    raise exception 'Only a team game (scramble, foursomes, greensomes) has a team handicap.' using errcode = '22023';
  end if;
  if r.status <> 'live' then
    raise exception 'The round has finished — its handicaps can''t change now.' using errcode = '22023';
  end if;
  if p_handicap is null or p_handicap < -20 or p_handicap > 80 then
    raise exception 'A team handicap is a whole number, from +20 to 80.' using errcode = '22023';
  end if;

  v_auto := coalesce(r.team_handicap_auto, r.team_handicap);
  if p_handicap = r.team_handicap then
    return r.team_handicap;  -- nothing to change
  end if;

  if p_handicap = v_auto then
    update public.live_rounds
       set team_handicap = v_auto, team_handicap_auto = null,
           team_handicap_set_by = null, team_handicap_set_at = null
     where id = p_round_id;
  else
    update public.live_rounds
       set team_handicap = p_handicap, team_handicap_auto = v_auto,
           team_handicap_set_by = me, team_handicap_set_at = now()
     where id = p_round_id;
  end if;

  -- Once scores are in, the team hears about it (everyone but whoever changed it).
  v_started := exists (select 1 from public.live_round_scores s where s.round_id = p_round_id and s.strokes is not null);
  if v_started then
    v_label := coalesce(nullif(btrim(r.team_name), ''),
                        case when r.team_number is not null then 'Team ' || r.team_number else 'Your team' end);
    for v_player in
      select distinct member_id from public.live_round_players
       where round_id = p_round_id and member_id is not null and member_id <> me
    loop
      perform public.notify_user(
        v_player.member_id,
        'live_team_handicap',
        format('%s now plays off %s', v_label, case when p_handicap < 0 then '+' || abs(p_handicap) else p_handicap::text end),
        case when p_handicap = v_auto
          then 'The organiser put the team handicap back to the worked-out figure. Scores so far are worked out again.'
          else format('Set by the organiser (worked out: %s). Scores so far are worked out again.',
                      case when v_auto < 0 then '+' || abs(v_auto) else v_auto::text end)
        end,
        jsonb_build_object('href', '/live/rounds/' || p_round_id, 'round_id', p_round_id),
        null
      );
    end loop;
  end if;

  return p_handicap;
end;
$$;
revoke all on function public.live_round_set_team_handicap(bigint, integer) from public, anon, authenticated;
grant execute on function public.live_round_set_team_handicap(bigint, integer) to authenticated;

-- Everyone watching the card, the day's board or the TV sees the new figure
-- straight away: the same ping a finish sends (0104), on the team handicap.
drop trigger if exists live_rounds_team_handicap_broadcast on public.live_rounds;
create trigger live_rounds_team_handicap_broadcast
  after update of team_handicap on public.live_rounds
  for each row
  when (old.team_handicap is distinct from new.team_handicap)
  execute function public.live_round_status_broadcast();
