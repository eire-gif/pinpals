-- Pinpals: replying to a comment on a feed post.
--
-- Until now every comment on a post was a comment on the POST. A member who
-- wanted to answer one particular person had nothing but "@Mark" in the
-- text, and Mark was never told.
--
-- One level of replies, the way most feeds do it: a comment either stands
-- on its own, or answers one top-level comment. Replying to a reply files
-- the new comment under the same top-level comment rather than nesting
-- deeper — a thread that indents forever on a phone is a column of text one
-- word wide. The client shows who was answered.
--
--   * parent_id: the top-level comment this one answers, or null.
--   * prepare_post_comment_reply() BEFORE INSERT: the parent must be on the
--     SAME post, must be visible (not hidden by a moderator) and must not be
--     by someone the replier has blocked or been blocked by — otherwise a
--     member could reply to a comment they cannot see and, through the
--     reply's notification, learn it exists. A reply to a reply is moved up
--     to that reply's own parent.
--   * ON DELETE CASCADE: deleting a comment takes its replies with it, as
--     every feed does — an answer with the question gone reads as nonsense.
--     The comment counter is a row trigger, so it sees every cascaded row
--     and the count stays right.
--
-- Notifying the person answered happens in TypeScript (addComment() in
-- src/lib/feed-operations.ts), with the rest of the feed's notifications.
--
-- Rollback:
--   drop trigger if exists post_comments_prepare_reply on public.post_comments;
--   drop function if exists public.prepare_post_comment_reply();
--   alter table public.post_comments drop column if exists parent_id;
--   grant insert (post_id, author_id, body) on public.post_comments to authenticated;

alter table public.post_comments
  add column if not exists parent_id bigint references public.post_comments (id) on delete cascade;

create index if not exists post_comments_parent_idx on public.post_comments (parent_id) where parent_id is not null;

comment on column public.post_comments.parent_id is
  'The top-level comment this one replies to, or null. One level only — see prepare_post_comment_reply().';

-- Members may now set parent_id on insert, and still nothing else.
revoke insert on public.post_comments from authenticated;
grant insert (post_id, author_id, body, parent_id) on public.post_comments to authenticated;

create or replace function public.prepare_post_comment_reply()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_parent public.post_comments%rowtype;
begin
  if new.parent_id is null then
    return new;
  end if;

  select * into v_parent from public.post_comments where id = new.parent_id;

  if not found
     or v_parent.post_id <> new.post_id
     or v_parent.hidden_at is not null
     or public.is_blocked(v_parent.author_id, new.author_id) then
    raise exception 'That comment is no longer available to reply to.';
  end if;

  -- A reply to a reply joins the same thread, one level deep.
  if v_parent.parent_id is not null then
    new.parent_id := v_parent.parent_id;
  end if;

  return new;
end;
$$;

revoke all on function public.prepare_post_comment_reply() from public, anon, authenticated;

drop trigger if exists post_comments_prepare_reply on public.post_comments;
create trigger post_comments_prepare_reply
  before insert on public.post_comments
  for each row execute function public.prepare_post_comment_reply();
