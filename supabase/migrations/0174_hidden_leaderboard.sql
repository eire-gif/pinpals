-- 0174 — Keep the leaderboard secret until the prize-giving (Oct 2026)
--
-- Asked by Eire, 18 Oct 2026: an option where only the organiser can see
-- who's winning on their phone. Players see their own card; the clubhouse
-- TV stays live; nobody else finds out who won until the organiser
-- announces it at the prize-giving and publishes the results.
--
-- live_match_days.leaderboard_hidden. While it's on, a player in the day can
-- see only their own card and the cards in their own tee group (the people
-- they're standing beside — they need them to certify a card), not the rest
-- of the field. The organiser — whoever started the day, or the captain,
-- secretary or event organisers of the society event it belongs to — sees
-- everything, as before. It's enforced in can_view_live_round, which every
-- read of a round, its players, card, scores and drives goes through, so
-- it isn't just hidden on the screen.
--
-- It comes off when the organiser publishes the results (trigger on
-- competition_results) or taps "Show the leaderboard to everyone"
-- (set_day_leaderboard_hidden). The TV board reads with the service client
-- and stays live, as asked; only the organiser can put a hidden day on a
-- TV (checked in /api/app/live/tv).
--
-- No drop statements.
--
-- Applied to production 18 Oct 2026.
--
-- Rollback:
--   drop trigger if exists competition_results_reveal on public.competition_results;
--   drop function if exists public.competition_results_reveal();
--   drop function if exists public.set_day_leaderboard_hidden(bigint, boolean);
--   drop function if exists public.live_day_is_organiser(bigint);
--   recreate can_view_live_round and can_view_match_day from 0104;
--   drop function if exists public.live_day_organiser(bigint, uuid);
--   alter table public.live_match_days drop column if exists leaderboard_hidden;

alter table public.live_match_days
  add column if not exists leaderboard_hidden boolean not null default false;

comment on column public.live_match_days.leaderboard_hidden is
  'Secret leaderboard (0174): players see only their own tee group; the organiser sees all. Off once the results are published.';

-- Who runs the day: whoever started it, or an officer of the society event
-- it's linked to (captain, secretary, vice-captain, event organisers).
create or replace function public.live_day_organiser(p_day_id bigint, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_user is not null and exists (
    select 1 from public.live_match_days d
     where d.id = p_day_id
       and (
         d.created_by = p_user
         or exists (
           select 1 from public.society_outings o
            where o.match_day_id = d.id and public.outing_officer(o.group_id, p_user)
         )
       )
  );
$$;
revoke all on function public.live_day_organiser(bigint, uuid) from public, anon, authenticated;

-- The same, for the app to know which view to show.
create or replace function public.live_day_is_organiser(p_day_id bigint)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.live_day_organiser(p_day_id, (select auth.uid()));
$$;
revoke all on function public.live_day_is_organiser(bigint) from public, anon, authenticated;
grant execute on function public.live_day_is_organiser(bigint) to authenticated;

-- A day: its players, its creator, and now the event's officers.
create or replace function public.can_view_match_day(p_day_id bigint)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select (select auth.uid()) is not null
     and exists (
       select 1 from public.live_match_days d
        where d.id = p_day_id
          and (
            d.created_by = (select auth.uid())
            or exists (
              select 1
                from public.live_rounds r
                join public.live_round_players p on p.round_id = r.id
               where r.match_day_id = d.id and p.member_id = (select auth.uid())
            )
            or public.live_day_organiser(d.id, (select auth.uid()))
          )
     );
$$;

-- A round: its own players and starter as before; in a day, everyone in the
-- day — unless the leaderboard is secret, when a player sees only the cards
-- of their own tee group (same tee time and start), and the organiser all.
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
         left join public.live_match_days d on d.id = r.match_day_id
        where r.id = p_round_id
          and (
            r.created_by = (select auth.uid())
            or exists (
              select 1 from public.live_round_players p
               where p.round_id = r.id and p.member_id = (select auth.uid())
            )
            or (
              r.match_day_id is not null
              and (
                (not d.leaderboard_hidden and public.can_view_match_day(r.match_day_id))
                or public.live_day_organiser(r.match_day_id, (select auth.uid()))
                or (
                  d.leaderboard_hidden
                  and (r.tee_time is not null or r.start_hole is not null)
                  and exists (
                    select 1
                      from public.live_rounds mine
                      join public.live_round_players mp on mp.round_id = mine.id and mp.member_id = (select auth.uid())
                     where mine.match_day_id = r.match_day_id
                       and mine.tee_time is not distinct from r.tee_time
                       and mine.start_hole is not distinct from r.start_hole
                       and mine.start_letter is not distinct from r.start_letter
                  )
                )
              )
            )
          )
     );
$$;

-- On or off, by the organiser.
create or replace function public.set_day_leaderboard_hidden(p_day_id bigint, p_hidden boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.live_day_organiser(p_day_id, (select auth.uid())) then
    raise exception 'Only the organiser can hide or show the leaderboard.' using errcode = '42501';
  end if;
  update public.live_match_days set leaderboard_hidden = coalesce(p_hidden, false) where id = p_day_id;
end;
$$;
revoke all on function public.set_day_leaderboard_hidden(bigint, boolean) from public, anon, authenticated;
grant execute on function public.set_day_leaderboard_hidden(bigint, boolean) to authenticated;

-- Publishing the results reveals the leaderboard.
create or replace function public.competition_results_reveal()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'published' then
    update public.live_match_days set leaderboard_hidden = false
     where id = new.match_day_id and leaderboard_hidden;
  end if;
  return new;
end;
$$;
revoke all on function public.competition_results_reveal() from public, anon, authenticated;

drop trigger if exists competition_results_reveal on public.competition_results;
create trigger competition_results_reveal
  after insert or update of status on public.competition_results
  for each row execute function public.competition_results_reveal();
