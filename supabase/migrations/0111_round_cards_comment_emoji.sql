-- Scorecards on round posts, and emoji on comments (9 Oct 2026).
--
-- 1. ROUND POSTS CARRY THE CARD. A round shared from a scorecard (0110)
--    now keeps it hole by hole in details.hole_pars / details.hole_scores,
--    so the feed draws a real scorecard instead of a row of chips. Both or
--    neither, one entry per hole, adding up to the score (and to course_par
--    when given). Mirrors src/lib/post-details.ts; redefines
--    post_details_valid() whole, as 0098-0100 did. Every existing row passes.
--
-- 2. COMMENT REACTIONS. A long press on a comment offers a few emoji. Still
--    one row per (comment, member) in post_comment_likes — a reaction is a
--    like with an emoji, as golf reactions are for posts (0096) — so
--    like_count stays "how many reacted". NULL emoji is a plain heart, which
--    is what every like before this reads as.
--    post_comments.emoji_counts is kept by the same trigger as like_count,
--    so the feed reads counts without counting rows. The list is fixed
--    here, so nothing else can be stored.
--
-- Applied to production 9 Oct 2026 in two parts (comment emoji, then
-- post_details_valid) — the Supabase tool refuses a batch with DROP in it,
-- hence the IF NOT EXISTS blocks instead of drop-and-create.
--
-- Rollback:
--   re-run 0100's post_details_valid();
--   drop policy if exists "members change their own comment reaction" on public.post_comment_likes;
--   revoke update (emoji) on public.post_comment_likes from authenticated;
--   alter table public.post_comment_likes drop constraint if exists post_comment_likes_emoji_ok,
--     drop column if exists emoji;
--   alter table public.post_comments drop column if exists emoji_counts;
--   re-run 0097's bump_post_comment_like_count() and its trigger.

create or replace function public.post_details_valid(p_kind text, d jsonb)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare
  k text;
  allowed text[];
  b jsonb;
  n int;
begin
  if p_kind = 'general' then
    return d is null;
  end if;
  if d is null or jsonb_typeof(d) <> 'object' then
    return false;
  end if;
  if pg_column_size(d) > 2048 then
    return false;
  end if;

  allowed := case p_kind
    when 'round' then array['score','holes','course_par','tee','played_on','differential',
                            'fairways_hit','fairways_total','gir','putts','birdies','best_hole',
                            'front_nine','back_nine','longest_drive','tee_time_id','achievement',
                            'hole_pars','hole_scores']
    when 'hole'  then array['hole','par','yards','score','club','achievement']
    when 'shot'  then array['hole','shot_number','club','distance_yards','lie','result']
    else null
  end;
  if allowed is null then
    return false;
  end if;
  for k in select jsonb_object_keys(d) loop
    if not (k = any(allowed)) then
      return false;
    end if;
  end loop;

  if p_kind = 'round' then
    if not public.post_detail_int(d, 'score', 18, 200, true) then return false; end if;
    if d ? 'holes' and not (d->'holes' = '9'::jsonb or d->'holes' = '18'::jsonb) then return false; end if;
    if not public.post_detail_int(d, 'course_par', 27, 80, false) then return false; end if;
    if not public.post_detail_text(d, 'tee', 20) then return false; end if;
    if d ? 'played_on' then
      if jsonb_typeof(d->'played_on') <> 'string' or (d->>'played_on') !~ '^\d{4}-\d{2}-\d{2}$' then return false; end if;
      begin
        if to_char((d->>'played_on')::date, 'YYYY-MM-DD') <> d->>'played_on' then return false; end if;
      exception when others then
        return false;
      end;
    end if;
    if d ? 'differential' then
      if jsonb_typeof(d->'differential') <> 'number'
         or (d->>'differential')::numeric not between -10 and 60 then return false; end if;
    end if;
    if not public.post_detail_int(d, 'fairways_hit', 0, 18, false) then return false; end if;
    if not public.post_detail_int(d, 'fairways_total', 0, 18, false) then return false; end if;
    if not public.post_detail_int(d, 'gir', 0, 18, false) then return false; end if;
    if not public.post_detail_int(d, 'putts', 0, 99, false) then return false; end if;
    if not public.post_detail_int(d, 'birdies', 0, 18, false) then return false; end if;
    -- 0099: the recap's nines (adding up to the score on 18 holes), longest
    -- drive, and the tee time it was (existence and "you played it" are
    -- checked by the website's createPost — a check constraint can't read
    -- other tables).
    if not public.post_detail_int(d, 'front_nine', 9, 99, false) then return false; end if;
    if not public.post_detail_int(d, 'back_nine', 9, 99, false) then return false; end if;
    if d ? 'front_nine' and d ? 'back_nine' and coalesce(d->>'holes', '18') <> '9'
       and (d->>'front_nine')::int + (d->>'back_nine')::int <> (d->>'score')::int then return false; end if;
    if not public.post_detail_int(d, 'longest_drive', 50, 450, false) then return false; end if;
    if not public.post_detail_int(d, 'tee_time_id', 1, 2147483647, false) then return false; end if;
    -- 0100: a claimed achievement must be one the round's numbers support
    -- (achievements.ts eligibleAchievements). Personal Best is checked
    -- against earlier rounds by the website; here only "a full 18".
    if d ? 'achievement' then
      if jsonb_typeof(d->'achievement') <> 'string' then return false; end if;
      if d->>'achievement' in ('hole_in_one', 'eagle') then
        if not (d ? 'best_hole') then return false; end if;
        if not public.post_hole_claim_ok(d->>'achievement',
                 (d->'best_hole'->>'score')::int, (d->'best_hole'->>'par')::int) then return false; end if;
      elsif d->>'achievement' = 'personal_best' then
        if coalesce(d->>'holes', '18') = '9' then return false; end if;
      elsif d->>'achievement' in ('breaking_70', 'breaking_80', 'breaking_90', 'breaking_100') then
        if coalesce(d->>'holes', '18') = '9' then return false; end if;
        if (d->>'score')::int >= substring(d->>'achievement' from 10)::int then return false; end if;
      else
        return false;
      end if;
    end if;
    if d ? 'fairways_hit' and d ? 'fairways_total'
       and (d->>'fairways_hit')::int > (d->>'fairways_total')::int then return false; end if;
    -- 0111: the card hole by hole (post-details.ts): both arrays, one entry
    -- per hole, whole numbers in range, adding up to the score and the par.
    if d ? 'hole_pars' or d ? 'hole_scores' then
      if not (d ? 'hole_pars' and d ? 'hole_scores') then return false; end if;
      if jsonb_typeof(d->'hole_pars') <> 'array' or jsonb_typeof(d->'hole_scores') <> 'array' then return false; end if;
      n := case when d->>'holes' = '9' then 9 else 18 end;
      if jsonb_array_length(d->'hole_pars') <> n or jsonb_array_length(d->'hole_scores') <> n then return false; end if;
      if exists (
        select 1 from jsonb_array_elements(d->'hole_pars') e
        where jsonb_typeof(e) <> 'number' or (e #>> '{}')::numeric <> trunc((e #>> '{}')::numeric)
           or (e #>> '{}')::numeric not between 3 and 6
      ) then return false; end if;
      if exists (
        select 1 from jsonb_array_elements(d->'hole_scores') e
        where jsonb_typeof(e) <> 'number' or (e #>> '{}')::numeric <> trunc((e #>> '{}')::numeric)
           or (e #>> '{}')::numeric not between 1 and 15
      ) then return false; end if;
      if (select sum((e #>> '{}')::int) from jsonb_array_elements(d->'hole_scores') e) <> (d->>'score')::int then return false; end if;
      if d ? 'course_par'
         and (select sum((e #>> '{}')::int) from jsonb_array_elements(d->'hole_pars') e) <> (d->>'course_par')::int then return false; end if;
    end if;
    if d ? 'best_hole' then
      b := d->'best_hole';
      if jsonb_typeof(b) <> 'object' then return false; end if;
      for k in select jsonb_object_keys(b) loop
        if not (k = any(array['hole','par','score'])) then return false; end if;
      end loop;
      if not public.post_detail_int(b, 'hole', 1, 27, true) then return false; end if;
      if not public.post_detail_int(b, 'par', 3, 6, false) then return false; end if;
      if not public.post_detail_int(b, 'score', 1, 15, true) then return false; end if;
    end if;
    return true;
  end if;

  if p_kind = 'hole' then
    if d ? 'achievement' then
      if jsonb_typeof(d->'achievement') <> 'string'
         or d->>'achievement' not in ('hole_in_one', 'eagle')
         or not (d ? 'score')
         or not public.post_hole_claim_ok(d->>'achievement', (d->>'score')::int, (d->>'par')::int) then
        return false;
      end if;
    end if;
    return public.post_detail_int(d, 'hole', 1, 27, true)
       and public.post_detail_int(d, 'par', 3, 6, false)
       and public.post_detail_int(d, 'yards', 30, 800, false)
       and public.post_detail_int(d, 'score', 1, 15, false)
       and public.post_detail_text(d, 'club', 24);
  end if;

  -- shot
  if not (d ? 'club' or d ? 'distance_yards' or d ? 'result') then return false; end if;
  if d ? 'lie' and not (jsonb_typeof(d->'lie') = 'string'
      and d->>'lie' = any(array['tee','fairway','rough','bunker','fringe','green','recovery'])) then return false; end if;
  return public.post_detail_int(d, 'hole', 1, 27, false)
     and public.post_detail_int(d, 'shot_number', 1, 15, false)
     and public.post_detail_text(d, 'club', 24)
     and public.post_detail_int(d, 'distance_yards', 1, 450, false)
     and public.post_detail_text(d, 'result', 40);
end;
$$;


-- ============ comment reactions ============

alter table public.post_comment_likes add column if not exists emoji text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'post_comment_likes_emoji_ok') then
    alter table public.post_comment_likes add constraint post_comment_likes_emoji_ok
      check (emoji is null or emoji = any (array['❤️', '👍', '😂', '😮', '👏', '🔥', '⛳']));
  end if;
end $$;

alter table public.post_comments add column if not exists emoji_counts jsonb not null default '{}'::jsonb;

-- Every like so far is a heart.
update public.post_comments
   set emoji_counts = jsonb_build_object('❤️', like_count)
 where like_count > 0 and emoji_counts = '{}'::jsonb;

-- Changing your reaction is an update of your own row, emoji only.
grant update (emoji) on public.post_comment_likes to authenticated;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'post_comment_likes' and policyname = 'members change their own comment reaction') then
    create policy "members change their own comment reaction"
      on public.post_comment_likes for update
      to authenticated
      using (user_id = (select auth.uid()))
      with check (
        user_id = (select auth.uid())
        and exists (select 1 from public.post_comments c where c.id = comment_id and c.hidden_at is null)
      );
  end if;
end $$;

create or replace function public.bump_post_comment_emoji(p_comment bigint, p_key text, p_delta int)
returns void
language sql
security definer
set search_path = public
as $$
  update public.post_comments
     set emoji_counts = case
           when coalesce((emoji_counts ->> p_key)::int, 0) + p_delta <= 0 then emoji_counts - p_key
           else jsonb_set(emoji_counts, array[p_key], to_jsonb(coalesce((emoji_counts ->> p_key)::int, 0) + p_delta))
         end
   where id = p_comment;
$$;
revoke all on function public.bump_post_comment_emoji(bigint, text, int) from public, anon, authenticated;

create or replace function public.bump_post_comment_like_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    update public.post_comments set like_count = like_count + 1 where id = new.comment_id;
    perform public.bump_post_comment_emoji(new.comment_id, coalesce(new.emoji, '❤️'), 1);
  elsif tg_op = 'DELETE' then
    update public.post_comments set like_count = greatest(like_count - 1, 0) where id = old.comment_id;
    perform public.bump_post_comment_emoji(old.comment_id, coalesce(old.emoji, '❤️'), -1);
  elsif tg_op = 'UPDATE' and new.emoji is distinct from old.emoji then
    perform public.bump_post_comment_emoji(old.comment_id, coalesce(old.emoji, '❤️'), -1);
    perform public.bump_post_comment_emoji(new.comment_id, coalesce(new.emoji, '❤️'), 1);
  end if;
  return null;
end;
$$;
revoke all on function public.bump_post_comment_like_count() from public, anon, authenticated;

create or replace trigger post_comment_likes_count
  after insert or delete or update of emoji on public.post_comment_likes
  for each row execute function public.bump_post_comment_like_count();
