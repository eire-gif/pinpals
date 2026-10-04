-- Comments: @mentions, likes and editing (Oct 2026 feed redesign, phase 5).
--
-- Every existing comment, id and reply keeps working unchanged: the three
-- new columns default to "no mentions, no likes, never edited", and nothing
-- about reading, replying (0092), deleting or hiding a comment changes.
--
--   post_comments.mentions   uuid[] of members named with @ in the comment
--   post_comments.like_count kept by a trigger on post_comment_likes
--   post_comments.edited_at  set when the author changes the body
--   post_comment_likes       one row per (comment, member)
--
-- MENTIONS are cleaned by the database, not trusted from the client. A
-- trigger keeps only members the commenter may name — their accepted
-- connections, the post's author, or someone already in that thread — who
-- can themselves see the post and haven't blocked (or been blocked by) the
-- commenter. Anyone else is silently dropped, at most ten are kept, and the
-- commenter never mentions themselves. So a direct insert can't be used to
-- page a stranger, and the website only ever notifies the cleaned list.
--
-- EDITING. 0088 deliberately refused edits: "an edit to a comment that has
-- been replied to changes what the replies were answering". Members now
-- asked for it, so it's allowed with that cost made visible instead —
-- edited_at is set by the database on every change of body, and the app
-- shows "Edited". Only the author, only the body, and never a comment a
-- moderator has hidden (editing must not launder a moderated comment).
--
-- LIKES on comments are plain likes (a heart and a number), not the golf
-- reactions posts have: a comment is a line in a conversation. Private to
-- nobody — like post likes, anyone who can see the comment can see them —
-- and they notify nobody, so the app writes them directly.
--
-- Rollback:
--   drop table if exists public.post_comment_likes;
--   drop trigger if exists post_comments_clean_mentions on public.post_comments;
--   drop trigger if exists post_comments_mark_edited on public.post_comments;
--   drop function if exists public.clean_post_comment_mentions();
--   drop function if exists public.mark_post_comment_edited();
--   drop function if exists public.bump_post_comment_like_count();
--   drop policy if exists "members edit their own visible comments" on public.post_comments;
--   revoke update (body) on public.post_comments from authenticated;
--   alter table public.post_comments drop column if exists mentions,
--     drop column if exists like_count, drop column if exists edited_at;
--   grant insert (post_id, author_id, body, parent_id) on public.post_comments to authenticated;

alter table public.post_comments
  add column if not exists mentions uuid[] not null default '{}',
  add column if not exists like_count integer not null default 0 check (like_count >= 0),
  add column if not exists edited_at timestamptz;

-- Members may now name people on insert, and change the body later.
grant insert (post_id, author_id, body, parent_id, mentions) on public.post_comments to authenticated;
grant update (body) on public.post_comments to authenticated;


-- ============ mentions: cleaned on the way in ============

create or replace function public.clean_post_comment_mentions()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_post public.posts%rowtype;
begin
  if new.mentions is null or cardinality(new.mentions) = 0 then
    new.mentions := '{}';
    return new;
  end if;

  select * into v_post from public.posts where id = new.post_id;

  new.mentions := coalesce(array(
    select m from (
      select distinct on (m) m, ord
      from unnest(new.mentions) with ordinality as t(m, ord)
      where m is not null and m <> new.author_id
      order by m, ord
    ) d
    where
      -- someone the commenter may name
      (
        public.are_connected(new.author_id, m)
        or m = v_post.author_id
        or exists (
          select 1 from public.post_comments c
          where c.post_id = new.post_id and c.author_id = m and c.hidden_at is null
        )
      )
      -- who isn't blocking, or blocked by, the commenter
      and not public.is_blocked(new.author_id, m)
      -- and who can see the post themselves (can_view_post()'s rule, for m)
      and (
        m = v_post.author_id
        or (
          v_post.hidden_at is null
          and not public.is_blocked(v_post.author_id, m)
          and (v_post.visibility = 'members' or public.are_connected(v_post.author_id, m))
        )
      )
    order by ord
    limit 10
  ), '{}');

  return new;
end;
$$;
revoke all on function public.clean_post_comment_mentions() from public, anon, authenticated;

drop trigger if exists post_comments_clean_mentions on public.post_comments;
create trigger post_comments_clean_mentions
  before insert on public.post_comments
  for each row execute function public.clean_post_comment_mentions();


-- ============ editing ============

create or replace function public.mark_post_comment_edited()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.body is distinct from old.body then
    new.edited_at := now();
  end if;
  return new;
end;
$$;
revoke all on function public.mark_post_comment_edited() from public, anon, authenticated;

drop trigger if exists post_comments_mark_edited on public.post_comments;
create trigger post_comments_mark_edited
  before update on public.post_comments
  for each row execute function public.mark_post_comment_edited();

drop policy if exists "members edit their own visible comments" on public.post_comments;
create policy "members edit their own visible comments"
  on public.post_comments for update
  to authenticated
  using (author_id = (select auth.uid()) and hidden_at is null)
  with check (author_id = (select auth.uid()) and hidden_at is null and public.can_view_post(post_id));


-- ============ comment likes ============

create table if not exists public.post_comment_likes (
  comment_id bigint not null references public.post_comments (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (comment_id, user_id)
);

create index if not exists post_comment_likes_user_idx on public.post_comment_likes (user_id, comment_id);

alter table public.post_comment_likes enable row level security;
revoke update, truncate, references, trigger on public.post_comment_likes from anon, authenticated;
revoke all on public.post_comment_likes from anon;
grant select, insert, delete on public.post_comment_likes to authenticated;

-- The subqueries read post_comments under the CALLER's policy, so "a
-- comment you can see" means exactly what it does everywhere else: a post
-- you can see, not hidden from you, nobody blocked.
drop policy if exists "comment viewers read comment likes" on public.post_comment_likes;
create policy "comment viewers read comment likes"
  on public.post_comment_likes for select
  to authenticated
  using (exists (select 1 from public.post_comments c where c.id = comment_id));

drop policy if exists "members like comments they can see" on public.post_comment_likes;
create policy "members like comments they can see"
  on public.post_comment_likes for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.post_comments c where c.id = comment_id and c.hidden_at is null)
  );

drop policy if exists "members remove their own comment likes" on public.post_comment_likes;
create policy "members remove their own comment likes"
  on public.post_comment_likes for delete
  to authenticated
  using (user_id = (select auth.uid()));

create or replace function public.bump_post_comment_like_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    update public.post_comments set like_count = like_count + 1 where id = new.comment_id;
  elsif tg_op = 'DELETE' then
    update public.post_comments set like_count = greatest(like_count - 1, 0) where id = old.comment_id;
  end if;
  return null;
end;
$$;
revoke all on function public.bump_post_comment_like_count() from public, anon, authenticated;

drop trigger if exists post_comment_likes_count on public.post_comment_likes;
create trigger post_comment_likes_count
  after insert or delete on public.post_comment_likes
  for each row execute function public.bump_post_comment_like_count();
