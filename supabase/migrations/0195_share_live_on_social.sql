-- 0195 — Share a live round or day with everyone on PinPals Social
-- (Oct 2026, claude/social-live.md)
--
-- Asked by Eire, 30 Oct 2026: an option to share a live round to everyone on
-- PinPals Social, not just the group. Decided: both society/group days (by
-- the organiser) and a player's own round; OFF unless someone switches it on.
--
-- 1. live_match_days.public_on_social — set by the day's organiser
--    (0174's live_day_organiser) with set_match_day_public(). Never while the
--    leaderboard is secret: a secret day can't be shared, and keeping a
--    shared day secret hides it again (the clause below checks both).
-- 2. live_rounds.public_on_social — a round that isn't part of a day, set by
--    whoever started it or a member playing in it (set_live_round_public).
--    A round inside a day is shared with the day, by the organiser.
-- 3. can_view_match_day / can_view_live_round: plus "it's shared, and the
--    viewer is 18 or over". Neither can be shared while a member under 18 is
--    playing in it (0159): a junior's card is never shown to strangers.
-- 4. Comments, likes and Great Shots (0194) on a shared round as well as a
--    day: live_day_comments.round_id and live_day_cheers.round_id, exactly
--    one of match_day_id / round_id set; their rules read
--    can_view_live_thread(day, round).
--
-- Additive except two NOT NULLs relaxed (match_day_id on 0194's two tables,
-- now one of two keys). can_view_match_day and can_view_live_round keep their
-- 0194 / 0174 bodies and gain one clause each.
--
-- Rollback:
--   delete rows with round_id, then restore the not nulls and drop the
--   round_id columns; recreate the two view functions from 0194 / 0174;
--   drop functions set_match_day_public, set_live_round_public,
--   can_view_live_thread, live_has_minor; drop the public_on_social columns.

-- ===========================================================================
-- 1–2. The switches
-- ===========================================================================

alter table public.live_match_days
  add column if not exists public_on_social boolean not null default false;
alter table public.live_rounds
  add column if not exists public_on_social boolean not null default false;

comment on column public.live_match_days.public_on_social is
  'Shared on PinPals Social (0195): any adult member can watch and comment. Set by the organiser; ignored while the leaderboard is secret.';
comment on column public.live_rounds.public_on_social is
  'Shared on PinPals Social (0195), for a round outside a day. Set by its starter or a member playing in it.';

create index if not exists live_match_days_public_idx on public.live_match_days (played_on desc) where public_on_social;
create index if not exists live_rounds_public_idx on public.live_rounds (played_on desc) where public_on_social and match_day_id is null;

-- A member under 18 playing in a day, or in a round.
create or replace function public.live_has_minor(p_day_id bigint, p_round_id bigint)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.live_rounds r
      join public.live_round_players p on p.round_id = r.id and p.member_id is not null
     where (r.match_day_id = p_day_id or r.id = p_round_id)
       and public.is_minor(p.member_id)
  );
$$;
revoke all on function public.live_has_minor(bigint, bigint) from public, anon, authenticated;

create or replace function public.set_match_day_public(p_day_id bigint, p_public boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := (select auth.uid());
begin
  if not public.live_day_organiser(p_day_id, me) then
    raise exception 'Only the organiser can share the day on Social.' using errcode = '42501';
  end if;
  if p_public then
    if (select leaderboard_hidden from public.live_match_days where id = p_day_id) then
      raise exception 'The leaderboard is being kept secret. Show it to everyone first.' using errcode = 'P0001';
    end if;
    if public.live_has_minor(p_day_id, null) then
      raise exception 'A member under 18 is playing, so the day can''t be shared on Social.' using errcode = 'P0001';
    end if;
  end if;
  update public.live_match_days set public_on_social = p_public where id = p_day_id;
end;
$$;
revoke all on function public.set_match_day_public(bigint, boolean) from public, anon;
grant execute on function public.set_match_day_public(bigint, boolean) to authenticated;

create or replace function public.set_live_round_public(p_round_id bigint, p_public boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := (select auth.uid());
  v_day bigint;
  v_creator uuid;
begin
  select match_day_id, created_by into v_day, v_creator from public.live_rounds where id = p_round_id;
  if not found then
    raise exception 'That round has gone.' using errcode = 'P0002';
  end if;
  if v_day is not null then
    raise exception 'This round is part of a day: the organiser shares the whole day.' using errcode = 'P0001';
  end if;
  if me is null or not (
    v_creator = me
    or exists (select 1 from public.live_round_players p where p.round_id = p_round_id and p.member_id = me)
  ) then
    raise exception 'Only someone playing in the round can share it.' using errcode = '42501';
  end if;
  if p_public and public.live_has_minor(null, p_round_id) then
    raise exception 'A member under 18 is playing, so the round can''t be shared on Social.' using errcode = 'P0001';
  end if;
  update public.live_rounds set public_on_social = p_public where id = p_round_id;
end;
$$;
revoke all on function public.set_live_round_public(bigint, boolean) from public, anon;
grant execute on function public.set_live_round_public(bigint, boolean) to authenticated;

-- ===========================================================================
-- 3. Who can see (0194 / 0174 bodies, plus the shared clause)
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
            or (
              not d.leaderboard_hidden
              and public.is_group_member(public.live_match_day_group(d.id), (select auth.uid()))
            )
            -- 0195: shared on Social, to adults.
            or (
              d.public_on_social
              and not d.leaderboard_hidden
              and not public.is_minor((select auth.uid()))
            )
          )
     );
$$;
revoke all on function public.can_view_match_day(bigint) from public;
revoke execute on function public.can_view_match_day(bigint) from anon;
grant execute on function public.can_view_match_day(bigint) to authenticated;

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
            -- 0195: a round outside a day, shared on Social, to adults.
            or (
              r.match_day_id is null
              and r.public_on_social
              and not public.is_minor((select auth.uid()))
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
revoke all on function public.can_view_live_round(bigint) from public;
revoke execute on function public.can_view_live_round(bigint) from anon;
grant execute on function public.can_view_live_round(bigint) to authenticated;

-- ===========================================================================
-- 4. Comments, likes and Great Shots on a round as well as a day
-- ===========================================================================

create or replace function public.can_view_live_thread(p_day_id bigint, p_round_id bigint)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_day_id is not null then public.can_view_match_day(p_day_id)
    when p_round_id is not null then public.can_view_live_round(p_round_id)
    else false
  end;
$$;
revoke all on function public.can_view_live_thread(bigint, bigint) from public, anon;
grant execute on function public.can_view_live_thread(bigint, bigint) to authenticated;

alter table public.live_day_comments
  add column if not exists round_id bigint references public.live_rounds (id) on delete cascade;
alter table public.live_day_comments alter column match_day_id drop not null;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'live_day_comments_one_thread') then
    alter table public.live_day_comments
      add constraint live_day_comments_one_thread check ((match_day_id is null) <> (round_id is null));
  end if;
end;
$$;
create index if not exists live_day_comments_round_idx on public.live_day_comments (round_id, created_at desc) where round_id is not null;
grant insert (round_id) on public.live_day_comments to authenticated;

alter table public.live_day_cheers
  add column if not exists id bigint generated always as identity,
  add column if not exists round_id bigint references public.live_rounds (id) on delete cascade;
-- The primary key was (match_day_id, member_id); a round's cheers have no day.
do $$
begin
  if exists (select 1 from pg_constraint where conname = 'live_day_cheers_pkey'
              and pg_get_constraintdef(oid) like '%match_day_id%') then
    alter table public.live_day_cheers drop constraint live_day_cheers_pkey;
    alter table public.live_day_cheers add constraint live_day_cheers_pkey primary key (id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'live_day_cheers_one_thread') then
    alter table public.live_day_cheers
      add constraint live_day_cheers_one_thread check ((match_day_id is null) <> (round_id is null));
  end if;
end;
$$;
alter table public.live_day_cheers alter column match_day_id drop not null;
create unique index if not exists live_day_cheers_day_member on public.live_day_cheers (match_day_id, member_id) where match_day_id is not null;
create unique index if not exists live_day_cheers_round_member on public.live_day_cheers (round_id, member_id) where round_id is not null;
grant insert (round_id) on public.live_day_cheers to authenticated;

alter policy "day viewers read comments" on public.live_day_comments
  using (
    public.can_view_live_thread(match_day_id, round_id)
    and (
      author_id = (select auth.uid())
      or (hidden_at is null and not public.is_blocked(author_id, (select auth.uid())))
    )
  );
alter policy "day viewers comment" on public.live_day_comments
  with check (author_id = (select auth.uid()) and public.can_view_live_thread(match_day_id, round_id));
-- A round's comments: deleted by their author, or by whoever started the round.
alter policy "authors and organisers delete comments" on public.live_day_comments
  using (
    author_id = (select auth.uid())
    or (match_day_id is not null and public.live_day_is_organiser(match_day_id))
    or (round_id is not null and exists (select 1 from public.live_rounds r where r.id = round_id and r.created_by = (select auth.uid())))
  );

alter policy "day viewers read cheers" on public.live_day_cheers
  using (public.can_view_live_thread(match_day_id, round_id));
alter policy "day viewers cheer" on public.live_day_cheers
  with check (member_id = (select auth.uid()) and public.can_view_live_thread(match_day_id, round_id));

-- Pinning: the day's organiser, or a round's starter.
create or replace function public.live_day_comment_pin(p_comment_id bigint, p_pin boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := (select auth.uid());
  v_day bigint;
  v_round bigint;
begin
  select match_day_id, round_id into v_day, v_round from public.live_day_comments where id = p_comment_id;
  if v_day is null and v_round is null then
    raise exception 'That comment has gone.' using errcode = 'P0002';
  end if;
  if not (
    (v_day is not null and public.live_day_organiser(v_day, me))
    or (v_round is not null and exists (select 1 from public.live_rounds where id = v_round and created_by = me))
  ) then
    raise exception 'Only the organiser can pin a comment.' using errcode = '42501';
  end if;
  if p_pin then
    update public.live_day_comments set pinned_at = null
     where pinned_at is not null and match_day_id is not distinct from v_day and round_id is not distinct from v_round;
    update public.live_day_comments set pinned_at = now() where id = p_comment_id;
  else
    update public.live_day_comments set pinned_at = null where id = p_comment_id;
  end if;
end;
$$;
revoke all on function public.live_day_comment_pin(bigint, boolean) from public, anon;
grant execute on function public.live_day_comment_pin(bigint, boolean) to authenticated;
