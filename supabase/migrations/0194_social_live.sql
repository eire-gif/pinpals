-- 0194 — Social: live circles, society days to watch, comments with likes
-- (Oct 2026, claude/social-live.md)
--
-- Asked by Eire, 28 Oct 2026: the Social tab redesigned as a mix of
-- Instagram, TikTok and Facebook (canvas "PinPals Social — style options",
-- row D, approved): live circles across the top for rounds going on now, a
-- full-screen live view of a society day with a leaderboard, Great Shots and
-- a comment stream (every comment with a like), society results in the feed
-- with their comments, and the society page with a LIVE banner.
--
-- 1. WHICH GROUP A LIVE DAY BELONGS TO. A day started from a society event is
--    linked through society_outings.match_day_id (0125). A day started
--    straight from a group's page today ("Start a round") wasn't linked to
--    anything; live_match_days.group_id now records it (set_match_day_group,
--    by whoever started the day, who must be in the group). Published results
--    carry their own group (0138). live_match_day_group() reads all three.
--
-- 2. THE GROUP CAN WATCH. can_view_match_day() also lets members of that
--    group see the day — and, through can_view_live_round() (0174, not
--    changed), its cards — so a society's members can follow their own
--    society day from Social without playing. Never while the leaderboard is
--    secret (0174): a member who isn't playing sees nothing of a secret day
--    until the results are published, exactly as before.
--
-- 3. COMMENTS ON A LIVE DAY, WITH LIKES. live_day_comments (one thread per
--    day: during play on the live view, and afterwards on the results card in
--    the feed) and live_day_comment_likes. Same rules as post comments
--    (0088/0097): whoever can see the day reads them, less hidden ones and
--    anyone blocked either way; you delete your own; the day's organiser
--    (0174's live_day_organiser) can delete or pin any. No under-18s (0159's
--    age guard and read rule, as for post comments). At most 10 comments a
--    minute per member.
--
-- 4. GREAT SHOTS ON A DAY. live_day_cheers: one per member per day, the
--    count shown on the live view and the results card.
--
-- Additive: one column, three tables, new functions, and can_view_match_day
-- replaced with the same body plus one clause. No drop statements except
-- "drop policy if exists" on policies this migration creates.
--
-- Rollback:
--   drop table if exists public.live_day_cheers, public.live_day_comment_likes, public.live_day_comments;
--   drop function if exists public.live_day_comment_pin(bigint, boolean);
--   drop function if exists public.set_match_day_group(bigint, bigint);
--   drop function if exists public.live_day_comment_like_count();
--   drop function if exists public.live_day_comment_rate();
--   recreate can_view_match_day from 0174;
--   drop function if exists public.live_match_day_group(bigint);
--   alter table public.live_match_days drop column if exists group_id;

-- ===========================================================================
-- 1. Which group a day belongs to
-- ===========================================================================

alter table public.live_match_days
  add column if not exists group_id bigint references public.groups (id) on delete set null;

comment on column public.live_match_days.group_id is
  'The group a day was started from (0194, set_match_day_group). Days from a society event are linked through society_outings.match_day_id instead.';

create index if not exists live_match_days_played_on_idx on public.live_match_days (played_on desc);
create index if not exists live_match_days_group_idx on public.live_match_days (group_id) where group_id is not null;

create or replace function public.live_match_day_group(p_day_id bigint)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select d.group_id from public.live_match_days d where d.id = p_day_id),
    (select o.group_id from public.society_outings o where o.match_day_id = p_day_id order by o.id limit 1),
    (select r.group_id from public.competition_results r
      where r.match_day_id = p_day_id and r.status = 'published' and r.group_id is not null
      limit 1)
  );
$$;

-- Internal: called by can_view_match_day (security definer). Not callable by
-- members, so it can't be used to find out which group ran any day.
revoke all on function public.live_match_day_group(bigint) from public, anon, authenticated;

-- Whoever started the day records the group it was started from. They must
-- be in that group; a day already linked to a society event keeps that link.
create or replace function public.set_match_day_group(p_day_id bigint, p_group_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := (select auth.uid());
begin
  if me is null then
    raise exception 'Please sign in again.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.live_match_days where id = p_day_id and created_by = me) then
    raise exception 'Only whoever started the day can do that.' using errcode = '42501';
  end if;
  if p_group_id is not null and not public.is_group_member(p_group_id, me) then
    raise exception 'You''re not in that group.' using errcode = '42501';
  end if;
  update public.live_match_days set group_id = p_group_id where id = p_day_id;
end;
$$;

revoke all on function public.set_match_day_group(bigint, bigint) from public, anon;
grant execute on function public.set_match_day_group(bigint, bigint) to authenticated;

-- ===========================================================================
-- 2. The group can watch (0174's body, plus the last clause)
-- ===========================================================================

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
            -- 0194: members of the day's group, unless the leaderboard is secret.
            or (
              not d.leaderboard_hidden
              and public.is_group_member(public.live_match_day_group(d.id), (select auth.uid()))
            )
          )
     );
$$;
revoke all on function public.can_view_match_day(bigint) from public;
revoke execute on function public.can_view_match_day(bigint) from anon;
grant execute on function public.can_view_match_day(bigint) to authenticated;

-- ===========================================================================
-- 3. Comments on a live day, with likes
-- ===========================================================================

create table if not exists public.live_day_comments (
  id bigint generated always as identity primary key,
  match_day_id bigint not null references public.live_match_days (id) on delete cascade,
  author_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 300),
  like_count integer not null default 0 check (like_count >= 0),
  pinned_at timestamptz,
  hidden_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists live_day_comments_day_idx on public.live_day_comments (match_day_id, created_at desc);
create index if not exists live_day_comments_author_idx on public.live_day_comments (author_id, created_at desc);

comment on table public.live_day_comments is
  'Comments on a live day (0194): the live view''s comment stream, and the results card''s thread afterwards.';

alter table public.live_day_comments enable row level security;
revoke all on public.live_day_comments from anon;
revoke insert, update, truncate, references, trigger on public.live_day_comments from authenticated;
grant select, delete on public.live_day_comments to authenticated;
grant insert (match_day_id, body) on public.live_day_comments to authenticated;

drop policy if exists "day viewers read comments" on public.live_day_comments;
create policy "day viewers read comments" on public.live_day_comments
  for select to authenticated
  using (
    public.can_view_match_day(match_day_id)
    and (
      author_id = (select auth.uid())
      or (hidden_at is null and not public.is_blocked(author_id, (select auth.uid())))
    )
  );

drop policy if exists "day viewers comment" on public.live_day_comments;
create policy "day viewers comment" on public.live_day_comments
  for insert to authenticated
  with check (author_id = (select auth.uid()) and public.can_view_match_day(match_day_id));

drop policy if exists "authors and organisers delete comments" on public.live_day_comments;
create policy "authors and organisers delete comments" on public.live_day_comments
  for delete to authenticated
  using (author_id = (select auth.uid()) or public.live_day_is_organiser(match_day_id));

drop policy if exists "no social for under 18s" on public.live_day_comments;
create policy "no social for under 18s" on public.live_day_comments
  as restrictive for select to authenticated
  using (not (select public.my_is_minor()));

-- Ten a minute: a live day is busy, but not that busy.
create or replace function public.live_day_comment_rate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select count(*) from public.live_day_comments
       where author_id = new.author_id and created_at > now() - interval '1 minute') >= 10 then
    raise exception 'You''re commenting very fast. Give it a minute.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all on function public.live_day_comment_rate() from public, anon, authenticated;

drop trigger if exists live_day_comments_rate on public.live_day_comments;
create trigger live_day_comments_rate before insert on public.live_day_comments
  for each row execute function public.live_day_comment_rate();

drop trigger if exists live_day_comments_age_guard on public.live_day_comments;
create trigger live_day_comments_age_guard before insert on public.live_day_comments
  for each row execute function public.age_guard('adult_only');

create table if not exists public.live_day_comment_likes (
  comment_id bigint not null references public.live_day_comments (id) on delete cascade,
  member_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (comment_id, member_id)
);

create index if not exists live_day_comment_likes_member_idx on public.live_day_comment_likes (member_id);

alter table public.live_day_comment_likes enable row level security;
revoke all on public.live_day_comment_likes from anon;
revoke insert, update, truncate, references, trigger on public.live_day_comment_likes from authenticated;
grant select, delete on public.live_day_comment_likes to authenticated;
grant insert (comment_id) on public.live_day_comment_likes to authenticated;

-- Seeing a like needs seeing the comment; the subquery runs under the
-- comments' own read policy.
drop policy if exists "comment viewers read likes" on public.live_day_comment_likes;
create policy "comment viewers read likes" on public.live_day_comment_likes
  for select to authenticated
  using (exists (select 1 from public.live_day_comments c where c.id = comment_id));

drop policy if exists "members like comments they can see" on public.live_day_comment_likes;
create policy "members like comments they can see" on public.live_day_comment_likes
  for insert to authenticated
  with check (
    member_id = (select auth.uid())
    and exists (select 1 from public.live_day_comments c where c.id = comment_id)
  );

drop policy if exists "members take back their likes" on public.live_day_comment_likes;
create policy "members take back their likes" on public.live_day_comment_likes
  for delete to authenticated
  using (member_id = (select auth.uid()));

drop trigger if exists live_day_comment_likes_age_guard on public.live_day_comment_likes;
create trigger live_day_comment_likes_age_guard before insert on public.live_day_comment_likes
  for each row execute function public.age_guard('adult_only');

create or replace function public.live_day_comment_like_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    update public.live_day_comments set like_count = like_count + 1 where id = new.comment_id;
  elsif tg_op = 'DELETE' then
    update public.live_day_comments set like_count = greatest(like_count - 1, 0) where id = old.comment_id;
  end if;
  return null;
end;
$$;
revoke all on function public.live_day_comment_like_count() from public, anon, authenticated;

drop trigger if exists live_day_comment_likes_count on public.live_day_comment_likes;
create trigger live_day_comment_likes_count after insert or delete on public.live_day_comment_likes
  for each row execute function public.live_day_comment_like_count();

-- The organiser pins one comment ("Prizegiving in the clubhouse at 6"), or
-- unpins it. Pinning a second unpins the first.
create or replace function public.live_day_comment_pin(p_comment_id bigint, p_pin boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := (select auth.uid());
  v_day bigint;
begin
  select match_day_id into v_day from public.live_day_comments where id = p_comment_id;
  if v_day is null then
    raise exception 'That comment has gone.' using errcode = 'P0002';
  end if;
  if not public.live_day_organiser(v_day, me) then
    raise exception 'Only the organiser can pin a comment.' using errcode = '42501';
  end if;
  if p_pin then
    update public.live_day_comments set pinned_at = null where match_day_id = v_day and pinned_at is not null;
    update public.live_day_comments set pinned_at = now() where id = p_comment_id;
  else
    update public.live_day_comments set pinned_at = null where id = p_comment_id;
  end if;
end;
$$;
revoke all on function public.live_day_comment_pin(bigint, boolean) from public, anon;
grant execute on function public.live_day_comment_pin(bigint, boolean) to authenticated;

-- ===========================================================================
-- 4. Great Shots on a day
-- ===========================================================================

create table if not exists public.live_day_cheers (
  match_day_id bigint not null references public.live_match_days (id) on delete cascade,
  member_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (match_day_id, member_id)
);

create index if not exists live_day_cheers_member_idx on public.live_day_cheers (member_id);

alter table public.live_day_cheers enable row level security;
revoke all on public.live_day_cheers from anon;
revoke insert, update, truncate, references, trigger on public.live_day_cheers from authenticated;
grant select, delete on public.live_day_cheers to authenticated;
grant insert (match_day_id) on public.live_day_cheers to authenticated;

drop policy if exists "day viewers read cheers" on public.live_day_cheers;
create policy "day viewers read cheers" on public.live_day_cheers
  for select to authenticated
  using (public.can_view_match_day(match_day_id));

drop policy if exists "day viewers cheer" on public.live_day_cheers;
create policy "day viewers cheer" on public.live_day_cheers
  for insert to authenticated
  with check (member_id = (select auth.uid()) and public.can_view_match_day(match_day_id));

drop policy if exists "members take back their cheers" on public.live_day_cheers;
create policy "members take back their cheers" on public.live_day_cheers
  for delete to authenticated
  using (member_id = (select auth.uid()));

drop trigger if exists live_day_cheers_age_guard on public.live_day_cheers;
create trigger live_day_cheers_age_guard before insert on public.live_day_cheers
  for each row execute function public.age_guard('adult_only');
