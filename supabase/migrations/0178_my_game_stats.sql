-- 0178 — My Game stats: a member's own taps per hole (Oct 2026)
--
-- Stage 2 of My Game (claude/my-game-stats.md). Members who turn on "Track
-- my stats" tap, per hole: their tee shot (left / fairway / right), putts,
-- which way they missed the green (short / long / left / right) and any
-- penalty strokes. Greens in regulation and par saves are worked out from
-- these and the score, never stored.
--
-- PRIVATE. Only the member reads or writes their own rows — not their
-- playing partners, not their society, not the people who can see their
-- scorecard. That's why this is its own table rather than columns on
-- live_round_scores (read by everyone in the game) or scorecard_holes
-- (read by whoever the card's visibility allows).
--
-- Nothing about scoring changes: live_round_scores, the score functions,
-- scorecard_from_live_round, certification (its hash covers strokes only)
-- and the lock screen are untouched. A row hangs off either:
--   - a live round (live_round_id) — tapped while playing. The member's
--     scorecard from that round has the same live_round_id, which is how
--     My Game finds them; or
--   - a scorecard (scorecard_id) — tapped afterwards in the 60-second
--     review, or on a card entered by hand.
-- Exactly one of the two. A live round deleted takes its taps with it; a
-- scorecard deleted takes its own.
--
-- Written only through my_hole_stats_set(): it checks the member played in
-- the round (or owns the card) and deletes the row when every field is
-- cleared. Deleting the account deletes the rows (on delete cascade).
--
-- Rollback:
--   drop function if exists public.my_hole_stats_set(bigint, bigint, smallint, smallint, text, text, smallint);
--   drop table if exists public.member_hole_stats;

create table if not exists public.member_hole_stats (
  id bigint generated always as identity primary key,
  member_id uuid not null references public.profiles (id) on delete cascade,
  live_round_id bigint references public.live_rounds (id) on delete cascade,
  scorecard_id bigint references public.scorecards (id) on delete cascade,
  hole smallint not null check (hole between 1 and 18),
  putts smallint check (putts is null or putts between 0 and 10),
  tee text check (tee is null or tee in ('left', 'fairway', 'right')),
  green_miss text check (green_miss is null or green_miss in ('short', 'long', 'left', 'right')),
  penalties smallint check (penalties is null or penalties between 0 and 9),
  updated_at timestamptz not null default now(),
  check ((live_round_id is null) <> (scorecard_id is null))
);

create unique index if not exists member_hole_stats_round_idx
  on public.member_hole_stats (member_id, live_round_id, hole) where live_round_id is not null;
create unique index if not exists member_hole_stats_card_idx
  on public.member_hole_stats (member_id, scorecard_id, hole) where scorecard_id is not null;
create index if not exists member_hole_stats_live_round_fk on public.member_hole_stats (live_round_id) where live_round_id is not null;
create index if not exists member_hole_stats_scorecard_fk on public.member_hole_stats (scorecard_id) where scorecard_id is not null;

alter table public.member_hole_stats enable row level security;

drop policy if exists "Members read their own hole stats" on public.member_hole_stats;
create policy "Members read their own hole stats" on public.member_hole_stats
  for select to authenticated using (member_id = (select auth.uid()));

revoke all on public.member_hole_stats from anon, authenticated;
grant select on public.member_hole_stats to authenticated;

comment on table public.member_hole_stats is
  'My Game stats (0178): a member''s own tee shot, putts, missed-green direction and penalties per hole, on a live round or a scorecard. Private to the member. Written only via my_hole_stats_set().';

create or replace function public.my_hole_stats_set(
  p_live_round_id bigint,
  p_scorecard_id bigint,
  p_hole smallint,
  p_putts smallint,
  p_tee text,
  p_green_miss text,
  p_penalties smallint
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_me uuid := (select auth.uid());
begin
  if v_me is null or not exists (select 1 from public.profiles where id = v_me and deleted_at is null) then
    raise exception 'You need to be signed in to save your stats.' using errcode = '42501';
  end if;
  if (p_live_round_id is null) = (p_scorecard_id is null) then
    raise exception 'Stats go on a round or a scorecard.' using errcode = '22023';
  end if;
  if p_hole is null or p_hole not between 1 and 18 then
    raise exception 'That hole isn''t on the card.' using errcode = '22023';
  end if;

  if p_live_round_id is not null then
    if not exists (select 1 from public.live_round_players p where p.round_id = p_live_round_id and p.member_id = v_me) then
      raise exception 'You can only keep stats for a round you played in.' using errcode = '42501';
    end if;
  else
    if not exists (select 1 from public.scorecards s where s.id = p_scorecard_id and s.member_id = v_me) then
      raise exception 'You can only keep stats on your own card.' using errcode = '42501';
    end if;
  end if;

  -- Everything cleared: nothing to keep.
  if p_putts is null and p_tee is null and p_green_miss is null and coalesce(p_penalties, 0) = 0 then
    delete from public.member_hole_stats
     where member_id = v_me and hole = p_hole
       and live_round_id is not distinct from p_live_round_id
       and scorecard_id is not distinct from p_scorecard_id;
    return;
  end if;

  if p_live_round_id is not null then
    insert into public.member_hole_stats (member_id, live_round_id, hole, putts, tee, green_miss, penalties)
    values (v_me, p_live_round_id, p_hole, p_putts, p_tee, p_green_miss, nullif(p_penalties, 0))
    on conflict (member_id, live_round_id, hole) where live_round_id is not null do update set
      putts = excluded.putts, tee = excluded.tee, green_miss = excluded.green_miss,
      penalties = excluded.penalties, updated_at = now();
  else
    insert into public.member_hole_stats (member_id, scorecard_id, hole, putts, tee, green_miss, penalties)
    values (v_me, p_scorecard_id, p_hole, p_putts, p_tee, p_green_miss, nullif(p_penalties, 0))
    on conflict (member_id, scorecard_id, hole) where scorecard_id is not null do update set
      putts = excluded.putts, tee = excluded.tee, green_miss = excluded.green_miss,
      penalties = excluded.penalties, updated_at = now();
  end if;
end;
$function$;

revoke all on function public.my_hole_stats_set(bigint, bigint, smallint, smallint, text, text, smallint) from public, anon;
grant execute on function public.my_hole_stats_set(bigint, bigint, smallint, smallint, text, text, smallint) to authenticated;

comment on function public.my_hole_stats_set(bigint, bigint, smallint, smallint, text, text, smallint) is
  'My Game (0178): save the caller''s own stats for one hole of a live round they played in, or of their own scorecard. All fields cleared deletes the row.';
