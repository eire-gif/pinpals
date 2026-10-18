-- 0179 — My Game: how far the first putt was (Oct 2026, claude/training.md)
--
-- Training's Putting Lab and My Game want holing % by distance: of the putts
-- you faced from 6–10ft, how many went in first time, and how many turned
-- into a three-putt. That needs one more tap per hole — the length of the
-- first putt, in six bands of feet — asked under Putts once there are any.
--
-- ADDITIVE ONLY, so an app build from before this migration keeps working:
--   - member_hole_stats gains a nullable first_putt column.
--   - my_hole_stats_set() gains an EIGHT-argument version with p_first_putt.
--     The 0178 seven-argument version stays, untouched: older builds keep
--     calling it, and its upsert doesn't name first_putt, so a distance
--     saved by a newer build survives an older build's save of the same hole.
--   - Newer builds call the eight-argument version and fall back to the
--     seven-argument one (PGRST202) if this migration isn't applied yet.
-- Still private to the member; the table's policies are unchanged.
--
-- Rollback:
--   drop function if exists public.my_hole_stats_set(bigint, bigint, smallint, smallint, text, text, smallint, text);
--   alter table public.member_hole_stats drop column if exists first_putt;

alter table public.member_hole_stats
  add column if not exists first_putt text
  check (first_putt is null or first_putt in ('0-3', '3-6', '6-10', '10-20', '20-30', '30+'));

comment on column public.member_hole_stats.first_putt is
  'My Game (0179): length of the first putt in feet, as a band: 0-3, 3-6, 6-10, 10-20, 20-30, 30+. Null when not tapped.';

create or replace function public.my_hole_stats_set(
  p_live_round_id bigint,
  p_scorecard_id bigint,
  p_hole smallint,
  p_putts smallint,
  p_tee text,
  p_green_miss text,
  p_penalties smallint,
  p_first_putt text
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_me uuid := (select auth.uid());
  -- No putts, no first putt (a chip-in).
  v_first text := case when coalesce(p_putts, 1) >= 1 then p_first_putt end;
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
  if p_putts is null and p_tee is null and p_green_miss is null and coalesce(p_penalties, 0) = 0 and v_first is null then
    delete from public.member_hole_stats
     where member_id = v_me and hole = p_hole
       and live_round_id is not distinct from p_live_round_id
       and scorecard_id is not distinct from p_scorecard_id;
    return;
  end if;

  if p_live_round_id is not null then
    insert into public.member_hole_stats (member_id, live_round_id, hole, putts, tee, green_miss, penalties, first_putt)
    values (v_me, p_live_round_id, p_hole, p_putts, p_tee, p_green_miss, nullif(p_penalties, 0), v_first)
    on conflict (member_id, live_round_id, hole) where live_round_id is not null do update set
      putts = excluded.putts, tee = excluded.tee, green_miss = excluded.green_miss,
      penalties = excluded.penalties, first_putt = excluded.first_putt, updated_at = now();
  else
    insert into public.member_hole_stats (member_id, scorecard_id, hole, putts, tee, green_miss, penalties, first_putt)
    values (v_me, p_scorecard_id, p_hole, p_putts, p_tee, p_green_miss, nullif(p_penalties, 0), v_first)
    on conflict (member_id, scorecard_id, hole) where scorecard_id is not null do update set
      putts = excluded.putts, tee = excluded.tee, green_miss = excluded.green_miss,
      penalties = excluded.penalties, first_putt = excluded.first_putt, updated_at = now();
  end if;
end;
$function$;

revoke all on function public.my_hole_stats_set(bigint, bigint, smallint, smallint, text, text, smallint, text) from public, anon;
grant execute on function public.my_hole_stats_set(bigint, bigint, smallint, smallint, text, text, smallint, text) to authenticated;

comment on function public.my_hole_stats_set(bigint, bigint, smallint, smallint, text, text, smallint, text) is
  'My Game (0179): as the 0178 version, plus the first putt''s distance band. Save the caller''s own stats for one hole of a live round they played in, or of their own scorecard. All fields cleared deletes the row.';
