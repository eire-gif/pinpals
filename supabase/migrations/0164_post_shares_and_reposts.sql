-- 0164 — Who shared a post, and sharing to your own feed (Oct 2026)
--
-- The approved mock-ups "PinPals Reactions & Share": a post shows how many
-- times it has been shared next to its comments, the share sheet adds
-- "Share to your feed", and the who-reacted sheet has a Shares tab.
--
-- 1. posts.share_count — how many times the post has been shared, kept by
--    a trigger on post_shares (members can't write it; same arrangement as
--    like_count in 0088).
--
-- 2. public.post_shares — one row per member per channel per post:
--    'feed' (a repost, below), 'pinpals' (sent in a chat), or the app it
--    went out through ('whatsapp', 'messages', 'email', 'facebook', 'x',
--    'copy_link', 'other'). The primary key makes it a count of people and
--    places, not of taps: sending the same post to WhatsApp five times
--    counts once, so the number can't be inflated.
--
--    PRIVATE. Each member reads only their own rows. Who you sent a post to
--    in a chat, or that you passed it on in WhatsApp, is never shown to
--    anyone — the post's author sees the number only. The only shares with
--    names are reposts, and those are posts: visible exactly as any post.
--
--    Written only through record_post_share() (and the repost trigger).
--
-- 3. posts.shared_post_id — a repost: "Share to your feed". The new post
--    carries the sharer's own caption and points at the original, which
--    every reader loads under their own RLS. Rules, in posts_check_repost():
--      * only a post you can see, that is shared with all members (a
--        connections-only post stays with its author's connections) and
--        isn't hidden;
--      * a repost of a repost points at the original;
--      * a repost is a general post with no photos of its own (the app
--        sends none; the website's createPost refuses them);
--      * it can't be changed afterwards (no UPDATE grant).
--    Deleting the original leaves the repost with shared_post_id null and
--    is_repost still true — the card then says the post is no longer
--    available, rather than showing as an empty post.
--
-- Rollback:
--   drop trigger if exists posts_repost_shared on public.posts;
--   drop trigger if exists posts_repost_unshared on public.posts;
--   drop trigger if exists posts_check_repost on public.posts;
--   drop function if exists public.posts_repost_shared(), public.posts_repost_unshared(),
--     public.posts_check_repost(), public.record_post_share(bigint, text),
--     public.bump_post_share_count();
--   drop table if exists public.post_shares;
--   revoke insert (shared_post_id) on public.posts from authenticated;
--   alter table public.posts drop column if exists shared_post_id, drop column if exists is_repost,
--     drop column if exists share_count;

-- ============ columns on posts ============

alter table public.posts
  add column if not exists share_count integer not null default 0 check (share_count >= 0);

alter table public.posts
  add column if not exists shared_post_id bigint references public.posts (id) on delete set null;

-- Set by posts_check_repost(), never by members (no grant): whether this
-- post was a share, which stays true after the original is deleted.
alter table public.posts
  add column if not exists is_repost boolean not null default false;

-- "Who shared this to their feed" — the Shares tab.
create index if not exists posts_shared_post_idx
  on public.posts (shared_post_id, created_at desc)
  where shared_post_id is not null;

-- A member may name the post they're sharing when they post; never change it.
grant insert (shared_post_id) on public.posts to authenticated;

-- ============ post_shares ============

create table if not exists public.post_shares (
  post_id bigint not null references public.posts (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  channel text not null check (channel in (
    'feed', 'pinpals', 'whatsapp', 'messages', 'email', 'facebook', 'x', 'copy_link', 'other'
  )),
  created_at timestamptz not null default now(),
  primary key (post_id, user_id, channel)
);

create index if not exists post_shares_user_idx on public.post_shares (user_id, post_id);

alter table public.post_shares enable row level security;
revoke all on public.post_shares from anon, authenticated;
grant select on public.post_shares to authenticated;

drop policy if exists "members read their own shares" on public.post_shares;
create policy "members read their own shares"
  on public.post_shares for select
  to authenticated
  using (user_id = (select auth.uid()));

-- Under-18s don't use Social (0159): the same guard as post_likes.
drop trigger if exists post_shares_age_guard on public.post_shares;
create trigger post_shares_age_guard
  before insert on public.post_shares
  for each row execute function public.age_guard('adult_only');

-- The counter. SECURITY DEFINER for the same reason as 0088's like count:
-- members have no UPDATE on posts' counters.
create or replace function public.bump_post_share_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    update public.posts set share_count = share_count + 1 where id = new.post_id;
  elsif tg_op = 'DELETE' then
    update public.posts set share_count = greatest(share_count - 1, 0) where id = old.post_id;
  end if;
  return null;
end;
$$;
revoke all on function public.bump_post_share_count() from public, anon, authenticated;

drop trigger if exists post_shares_count on public.post_shares;
create trigger post_shares_count
  after insert or delete on public.post_shares
  for each row execute function public.bump_post_share_count();

-- ============ record_post_share() ============
--
-- The app calls this after a send in a chat or after the phone's share
-- sheet hands the link to an app. Only for a post the caller can see, and
-- never 'feed' (a repost records itself). Returns the post's new count.
-- Repeats are ignored (the primary key), so a retry is harmless.
create or replace function public.record_post_share(p_post_id bigint, p_channel text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := (select auth.uid());
  v_count integer;
begin
  if v_actor is null then
    raise exception 'Sign in to share posts.' using errcode = '42501';
  end if;
  if p_channel is null or p_channel = 'feed' or p_channel not in (
    'pinpals', 'whatsapp', 'messages', 'email', 'facebook', 'x', 'copy_link', 'other'
  ) then
    raise exception 'That isn''t a way to share a post.' using errcode = '22023';
  end if;
  if not public.can_view_post(p_post_id) then
    raise exception 'That post is no longer available.' using errcode = '42501';
  end if;

  insert into public.post_shares (post_id, user_id, channel)
  values (p_post_id, v_actor, p_channel)
  on conflict do nothing;

  select share_count into v_count from public.posts where id = p_post_id;
  return coalesce(v_count, 0);
end;
$$;
revoke all on function public.record_post_share(bigint, text) from public, anon;
grant execute on function public.record_post_share(bigint, text) to authenticated;

-- ============ reposts ============

create or replace function public.posts_check_repost()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target record;
begin
  new.is_repost := new.shared_post_id is not null;
  if new.shared_post_id is null then
    return new;
  end if;

  select id, shared_post_id into v_target from public.posts where id = new.shared_post_id;
  if not found then
    raise exception 'That post is no longer available.' using errcode = '23503';
  end if;
  -- Share the original, never a share of a share.
  if v_target.shared_post_id is not null then
    new.shared_post_id := v_target.shared_post_id;
  end if;

  select id, author_id, visibility, hidden_at into v_target from public.posts where id = new.shared_post_id;
  if not found then
    raise exception 'That post is no longer available.' using errcode = '23503';
  end if;

  -- The website's own server code (service role) is trusted; a member must
  -- be able to see the post. can_view_post() reads auth.uid() itself.
  if (select auth.uid()) is not null and not public.can_view_post(new.shared_post_id) then
    raise exception 'That post is no longer available.' using errcode = '42501';
  end if;
  if v_target.visibility <> 'members' or v_target.hidden_at is not null then
    raise exception 'Only posts shared with all members can be shared to your feed.' using errcode = '42501';
  end if;
  if coalesce(new.kind, 'general') <> 'general' or new.details is not null then
    raise exception 'A shared post is a plain post with your own words.' using errcode = '22023';
  end if;

  return new;
end;
$$;
revoke all on function public.posts_check_repost() from public, anon, authenticated;

drop trigger if exists posts_check_repost on public.posts;
create trigger posts_check_repost
  before insert on public.posts
  for each row execute function public.posts_check_repost();

-- A repost counts as a share of the original ('feed').
create or replace function public.posts_repost_shared()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.shared_post_id is not null then
    insert into public.post_shares (post_id, user_id, channel)
    values (new.shared_post_id, new.author_id, 'feed')
    on conflict do nothing;
  end if;
  return null;
end;
$$;
revoke all on function public.posts_repost_shared() from public, anon, authenticated;

drop trigger if exists posts_repost_shared on public.posts;
create trigger posts_repost_shared
  after insert on public.posts
  for each row execute function public.posts_repost_shared();

-- Deleting your repost takes your 'feed' share back off the count, unless
-- you have another repost of the same post still up.
create or replace function public.posts_repost_unshared()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.shared_post_id is not null and not exists (
    select 1 from public.posts
    where shared_post_id = old.shared_post_id and author_id = old.author_id and id <> old.id
  ) then
    delete from public.post_shares
    where post_id = old.shared_post_id and user_id = old.author_id and channel = 'feed';
  end if;
  return null;
end;
$$;
revoke all on function public.posts_repost_unshared() from public, anon, authenticated;

drop trigger if exists posts_repost_unshared on public.posts;
create trigger posts_repost_unshared
  after delete on public.posts
  for each row execute function public.posts_repost_unshared();
