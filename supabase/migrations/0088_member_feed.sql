-- ============================================================================
-- The feed: members posting their rounds, and everyone else liking and
-- commenting on them
-- ============================================================================
--
-- Four tables, one private bucket, and one rule that decides all of them:
-- can_view_post(). Everything a member can do to a post — see it, see its
-- photos, like it, comment on it, read its comments — is gated on that one
-- predicate, so "who can see this" has exactly one answer rather than five
-- that happen to agree until the next change to any of them. 0087 is the
-- most recent reminder of what two answers to one question turns into.
--
-- WHO CAN SEE A POST. Its author, always. Anyone else only if:
--   * it has not been hidden by a moderator (or by its author's account
--     being deleted — see src/lib/account-deletion.ts), and
--   * neither of them has blocked the other, and
--   * it was posted to all members, OR the two of them are connected.
--
-- Anonymous visitors see nothing. The feed is a members' room — a photo of
-- someone's fourball is not a marketing asset for the homepage, and nobody
-- posting one should have to wonder whether it is.
--
-- `members` RATHER THAN `public`. The visibility value for "everyone on
-- PinPals" is spelled `members` on purpose: `public` would read, to the next
-- person extending this, as "anonymous visitors too", and the column would
-- one day be made to mean that by someone being consistent with its name.
--
-- PHOTOS ARE PRIVATE, for the same reason message photos are (0086): a post
-- shared with connections only cannot have its photos sitting at a public
-- URL anyone can pass around. The bucket is reachable only by signed URL,
-- and a signed URL is only issued to someone can_view_post() already agrees
-- can see the post. Members cannot INSERT into the bucket at all — the
-- service role is the only writer, so the only way a photo gets in is
-- through uploadPostImage() and therefore through sharp, which strips EXIF.
-- A photo of the 18th green carries the course's coordinates, which is
-- harmless; a photo of a new driver in a hallway carries a home address,
-- which is not, and the pipeline cannot tell them apart.
--
-- COUNTS ARE DENORMALISED onto posts and kept by triggers. A feed of twenty
-- posts that counted its likes and comments per row would be forty extra
-- aggregate queries per page, each re-running can_view_post() for every row
-- it touched. The trigger functions are SECURITY DEFINER because members
-- have no UPDATE grant on the count columns — which is the point: a member
-- cannot set their own post's like_count to 4,000.
--
-- Rollback:
--   drop table if exists public.post_comments, public.post_likes,
--     public.post_images, public.posts cascade;
--   drop function if exists public.can_view_post(bigint);
--   drop function if exists public.post_image_post_id(text);
--   drop function if exists public.bump_post_like_count();
--   drop function if exists public.bump_post_comment_count();
--   drop policy if exists "post viewers read post photos" on storage.objects;
--   delete from storage.buckets where id = 'post-images';
--   -- and restore the two check constraints below to their previous forms.


-- ============ posts ============

create table if not exists public.posts (
  id bigint generated always as identity primary key,
  author_id uuid not null references public.profiles (id) on delete cascade,
  -- Not null, empty allowed: a post can be photos with no caption. Every
  -- reader treats body as a string, so "no caption" is '' rather than a null
  -- that each of them would have to remember. src/lib/feed-operations.ts
  -- refuses a post with neither a caption nor a photo.
  body text not null default '' check (char_length(body) <= 2000),
  visibility text not null default 'members'
    check (visibility in ('members', 'connections')),
  -- Where the round was played. Optional: plenty of posts are about a
  -- lesson, a new putter or the range.
  club_id bigint references public.clubs (id) on delete set null,
  like_count integer not null default 0 check (like_count >= 0),
  comment_count integer not null default 0 check (comment_count >= 0),
  -- Moderation. Set by staff through the service role, or by the account
  -- deletion flow. A hidden post is still visible to its author, so a
  -- member is never left wondering where their post went.
  hidden_at timestamptz,
  hidden_by uuid references public.profiles (id) on delete set null,
  hidden_reason text check (char_length(hidden_reason) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The feed reads newest first with a (created_at, id) keyset cursor; a
-- member's own page reads the same way filtered by author.
create index if not exists posts_feed_idx on public.posts (created_at desc, id desc);
create index if not exists posts_author_idx on public.posts (author_id, created_at desc, id desc);
create index if not exists posts_club_idx on public.posts (club_id) where club_id is not null;

drop trigger if exists posts_set_updated_at on public.posts;
create trigger posts_set_updated_at
  before update on public.posts
  for each row execute function public.set_updated_at();

alter table public.posts enable row level security;

-- Column-level grants rather than a trigger, because RLS is row-level and
-- the thing to stop here is a column: a member may write their own caption,
-- audience and course, and must not be able to write a like count, a
-- moderation flag or a timestamp. A column that is not granted cannot be
-- named in an INSERT or UPDATE at all, so there is nothing to validate.
revoke insert, update on public.posts from anon, authenticated;
grant insert (author_id, body, visibility, club_id) on public.posts to authenticated;
grant update (body, visibility, club_id) on public.posts to authenticated;
revoke all on public.posts from anon;
revoke truncate, references, trigger on public.posts from authenticated;


-- ============ can_view_post() ============
--
-- SECURITY DEFINER so it can be called from the policies on post_images,
-- post_likes, post_comments and storage.objects without each of those
-- needing its own way of reading `posts` — and so that the block check can
-- see both directions, which blocked_users' own "your rows only" policy
-- would otherwise hide (same reasoning as is_blocked() in 0049).
--
-- It answers only "may the CALLER see this post": auth.uid() is read inside,
-- never taken as an argument, so walking every post id tells a member
-- nothing beyond which posts they could already read.
--
-- `coalesce(..., false)` because a policy that evaluates to null denies,
-- which is right, but a function that can return null is one that will one
-- day be negated somewhere (0066 is that day, for invites).
create or replace function public.can_view_post(target_post_id bigint)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce((
    select
      p.author_id = auth.uid()
      or (
        auth.uid() is not null
        and p.hidden_at is null
        and not public.is_blocked(p.author_id, auth.uid())
        and (
          p.visibility = 'members'
          or public.are_connected(p.author_id, auth.uid())
        )
      )
    from public.posts p
    where p.id = target_post_id
  ), false);
$$;

revoke all on function public.can_view_post(bigint) from public, anon, authenticated;
grant execute on function public.can_view_post(bigint) to authenticated;


-- The SELECT policy on posts itself is written inline rather than as
-- can_view_post(id): it is evaluated once per row of every feed page, and
-- the inline form lets the planner see `visibility = 'members'` directly
-- instead of a function call per row. It must say exactly what
-- can_view_post() says — feed.test.ts asserts the two agree for every
-- fixture post and every fixture member.
drop policy if exists "members read posts they may see" on public.posts;
create policy "members read posts they may see"
  on public.posts for select
  to authenticated
  using (
    author_id = (select auth.uid())
    or (
      hidden_at is null
      and not public.is_blocked(author_id, (select auth.uid()))
      and (
        visibility = 'members'
        or public.are_connected(author_id, (select auth.uid()))
      )
    )
  );

drop policy if exists "members write their own posts" on public.posts;
create policy "members write their own posts"
  on public.posts for insert
  to authenticated
  with check (author_id = (select auth.uid()));

drop policy if exists "members edit their own posts" on public.posts;
create policy "members edit their own posts"
  on public.posts for update
  to authenticated
  using (author_id = (select auth.uid()))
  with check (author_id = (select auth.uid()));

drop policy if exists "members delete their own posts" on public.posts;
create policy "members delete their own posts"
  on public.posts for delete
  to authenticated
  using (author_id = (select auth.uid()));


-- ============ post_images ============
--
-- `path` is the STORAGE PATH, never a URL — a signed URL expires, and a
-- column of expired URLs is a feed whose photos all stop loading on a timer.
-- Readers sign on read, as message photos do.
--
-- Members cannot write here: a row is only meaningful if the object it
-- names went in through the service role, and the service role is what
-- writes both. No insert/update/delete grant, not merely no policy.
create table if not exists public.post_images (
  id bigint generated always as identity primary key,
  post_id bigint not null references public.posts (id) on delete cascade,
  path text not null unique check (char_length(path) <= 300),
  -- Six photos is a round: the first tee, a hole worth remembering, the
  -- scorecard, the fourball, the view, the pint. More than that is an
  -- album, and a feed of albums is a feed nobody scrolls.
  position smallint not null check (position between 0 and 5),
  width integer check (width > 0),
  height integer check (height > 0),
  created_at timestamptz not null default now(),
  unique (post_id, position)
);

create index if not exists post_images_post_idx on public.post_images (post_id, position);

alter table public.post_images enable row level security;
revoke insert, update, delete, truncate, references, trigger on public.post_images from anon, authenticated;
revoke select on public.post_images from anon;

drop policy if exists "post viewers read post images" on public.post_images;
create policy "post viewers read post images"
  on public.post_images for select
  to authenticated
  using (public.can_view_post(post_id));


-- ============ post_likes ============

create table if not exists public.post_likes (
  post_id bigint not null references public.posts (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

-- "Which of these twenty posts have I liked" — the feed asks it per page.
create index if not exists post_likes_user_idx on public.post_likes (user_id, post_id);

alter table public.post_likes enable row level security;
revoke update, truncate, references, trigger on public.post_likes from anon, authenticated;
revoke all on public.post_likes from anon;

-- Who liked a post is visible to anyone who can see the post, exactly as on
-- every social network anyone has used. Liking is a public act.
drop policy if exists "post viewers read likes" on public.post_likes;
create policy "post viewers read likes"
  on public.post_likes for select
  to authenticated
  using (public.can_view_post(post_id));

-- You can only like what you can see, and only as yourself. Liking your own
-- post is allowed: it is harmless and every platform permits it.
drop policy if exists "members like posts they can see" on public.post_likes;
create policy "members like posts they can see"
  on public.post_likes for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and public.can_view_post(post_id)
  );

drop policy if exists "members remove their own likes" on public.post_likes;
create policy "members remove their own likes"
  on public.post_likes for delete
  to authenticated
  using (user_id = (select auth.uid()));


-- ============ post_comments ============

create table if not exists public.post_comments (
  id bigint generated always as identity primary key,
  post_id bigint not null references public.posts (id) on delete cascade,
  author_id uuid not null references public.profiles (id) on delete cascade,
  body text not null check (char_length(trim(both from body)) > 0 and char_length(body) <= 1000),
  hidden_at timestamptz,
  hidden_by uuid references public.profiles (id) on delete set null,
  hidden_reason text check (char_length(hidden_reason) <= 500),
  created_at timestamptz not null default now()
);

create index if not exists post_comments_post_idx on public.post_comments (post_id, created_at, id);
create index if not exists post_comments_author_idx on public.post_comments (author_id);

alter table public.post_comments enable row level security;
-- No editing comments. An edit to a comment that has been replied to
-- changes what the replies were answering; delete-and-repost is honest.
revoke update, truncate, references, trigger on public.post_comments from anon, authenticated;
revoke all on public.post_comments from anon;
revoke insert on public.post_comments from authenticated;
grant insert (post_id, author_id, body) on public.post_comments to authenticated;

-- A comment is visible to anyone who can see its post, less two things: a
-- comment hidden by a moderator (still visible to the person who wrote it),
-- and a comment by somebody the reader has blocked or been blocked by. The
-- second is the same rule 0087 settled for group threads — blocking someone
-- so as not to hear from them has to hold in a comment thread too.
drop policy if exists "post viewers read comments" on public.post_comments;
create policy "post viewers read comments"
  on public.post_comments for select
  to authenticated
  using (
    public.can_view_post(post_id)
    and (
      author_id = (select auth.uid())
      or (
        hidden_at is null
        and not public.is_blocked(author_id, (select auth.uid()))
      )
    )
  );

-- can_view_post() already refuses a post whose author has blocked the
-- commenter (or vice versa), so a blocked member cannot comment on the
-- blocker's posts. It does not stop them commenting on a THIRD member's
-- post that the blocker also reads — and the read policy above is what keeps
-- that comment out of the blocker's sight.
drop policy if exists "members comment on posts they can see" on public.post_comments;
create policy "members comment on posts they can see"
  on public.post_comments for insert
  to authenticated
  with check (
    author_id = (select auth.uid())
    and public.can_view_post(post_id)
  );

-- Your own comment, or any comment on your own post. The second is what
-- lets a member keep their own post's thread civil without waiting for a
-- moderator — the same power every platform gives a post's author.
drop policy if exists "members delete own comments or comments on own posts" on public.post_comments;
create policy "members delete own comments or comments on own posts"
  on public.post_comments for delete
  to authenticated
  using (
    author_id = (select auth.uid())
    or exists (
      select 1 from public.posts p
      where p.id = post_id and p.author_id = (select auth.uid())
    )
  );


-- ============ the counters ============
--
-- SECURITY DEFINER because members have no UPDATE grant on like_count or
-- comment_count — see the header. Not executable by anyone: a trigger
-- function has no business being callable, and function-grants.test.ts
-- holds this to that.
--
-- greatest(…, 0) is belt and braces for a delete that races the cascade
-- from a deleted post; the check constraint would otherwise turn a tidy
-- no-op into an error in somebody's request.

create or replace function public.bump_post_like_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    update public.posts set like_count = like_count + 1 where id = new.post_id;
  elsif tg_op = 'DELETE' then
    update public.posts set like_count = greatest(like_count - 1, 0) where id = old.post_id;
  end if;
  return null;
end;
$$;

revoke all on function public.bump_post_like_count() from public, anon, authenticated;

drop trigger if exists post_likes_count on public.post_likes;
create trigger post_likes_count
  after insert or delete on public.post_likes
  for each row execute function public.bump_post_like_count();

-- Counts VISIBLE comments, so a moderator hiding one takes it off the
-- number too. A count that says 3 above a thread showing 2 reads as a bug.
create or replace function public.bump_post_comment_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.hidden_at is null then
      update public.posts set comment_count = comment_count + 1 where id = new.post_id;
    end if;
  elsif tg_op = 'DELETE' then
    if old.hidden_at is null then
      update public.posts set comment_count = greatest(comment_count - 1, 0) where id = old.post_id;
    end if;
  elsif tg_op = 'UPDATE' then
    if old.hidden_at is null and new.hidden_at is not null then
      update public.posts set comment_count = greatest(comment_count - 1, 0) where id = new.post_id;
    elsif old.hidden_at is not null and new.hidden_at is null then
      update public.posts set comment_count = comment_count + 1 where id = new.post_id;
    end if;
  end if;
  return null;
end;
$$;

revoke all on function public.bump_post_comment_count() from public, anon, authenticated;

drop trigger if exists post_comments_count on public.post_comments;
create trigger post_comments_count
  after insert or delete or update of hidden_at on public.post_comments
  for each row execute function public.bump_post_comment_count();


-- ============ the bucket ============
--
-- 5MB matches the other photo buckets; uploadPostImage() downscales to
-- 2000px long edge before anything reaches here.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'post-images',
  'post-images',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

-- Objects are named `<post_id>/<uuid>.<ext>`, so the folder is the
-- authorization key. The CASE guards the cast, for the reason spelled out
-- on message_image_conversation_id() in 0086: a policy that raises fails
-- somebody's query rather than declining it.
create or replace function public.post_image_post_id(object_name text)
returns bigint
language sql
immutable
set search_path = public
as $$
  select case
    when split_part(object_name, '/', 1) ~ '^[0-9]{1,18}$'
      then split_part(object_name, '/', 1)::bigint
    else null
  end;
$$;

revoke all on function public.post_image_post_id(text) from public, anon;
grant execute on function public.post_image_post_id(text) to authenticated;

drop policy if exists "post viewers read post photos" on storage.objects;
create policy "post viewers read post photos"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'post-images'
    and public.can_view_post(public.post_image_post_id(name))
  );

-- No insert/update/delete policy for `authenticated` on this bucket, on
-- purpose, and not backed by a table-level revoke — storage.objects is
-- shared by every bucket. See 0086's identical note.


-- ============ reporting a post or a comment ============
--
-- The report flow already exists (0016) and every moderation tool reads
-- `reports`; a post is one more thing it can point at.
alter table public.reports drop constraint if exists reports_target_type_check;
alter table public.reports add constraint reports_target_type_check
  check (target_type in (
    'user', 'listing', 'tee_time_invite', 'message', 'conversation', 'order', 'review',
    'post', 'post_comment'
  ));


-- ============ a preference for feed notifications ============
--
-- A comment on your post notifies you; see notifyPostCommented() in
-- src/lib/feed-operations.ts. It joins the OPTIONAL set — a comment is not
-- money — and like every optional category, no stored row means enabled.
--
-- Likes are recorded in-app only and never emailed or pushed, which is
-- decided in TypeScript, not here: a phone that buzzes every time somebody
-- taps a heart is a phone whose owner turns notifications off for the
-- whole app, comments and tee times included.
alter table public.notification_preferences
  drop constraint if exists notification_preferences_category_check;

alter table public.notification_preferences
  add constraint notification_preferences_category_check
  check (category in ('messages', 'offers', 'auctions', 'reviews', 'tee_times', 'feed'));
