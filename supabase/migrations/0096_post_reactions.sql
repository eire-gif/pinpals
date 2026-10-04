-- Golf reactions (Oct 2026 feed redesign, phase 4).
--
-- A reaction is a like with a flavour, so it lives where likes already do:
--
--   post_likes.reaction    'great_shot' | 'on_fire' | 'nice_round' |
--                          'amazing' | 'unlucky'. Defaults to great_shot,
--                          which is what every existing like becomes.
--   posts.reaction_counts  {"on_fire": 3, "great_shot": 1, ...}, kept by
--                          the same trigger that keeps posts.like_count.
--
-- Nothing about a like changes meaning: one row per (post, member), visible
-- to anyone who can see the post, like_count is still the total, and an app
-- or web build that only sends "liked: true" still works — it records the
-- default. The list and labels live in src/lib/reactions.ts (and its copy in
-- the app); the check constraint below is the database's copy of the list.
--
-- CHANGING a reaction is an UPDATE of that one column, which members could
-- not do before (0088 revoked UPDATE on post_likes). It is granted on
-- `reaction` alone, through a policy that also re-checks can_view_post().
--
-- Rollback:
--   drop trigger if exists post_likes_count on public.post_likes;
--   (restore bump_post_like_count() and the trigger from 0088)
--   alter table public.posts drop column if exists reaction_counts;
--   drop policy if exists "members change their own reaction" on public.post_likes;
--   revoke update (reaction) on public.post_likes from authenticated;
--   alter table public.post_likes drop column if exists reaction;

alter table public.post_likes
  add column if not exists reaction text not null default 'great_shot'
    check (reaction in ('great_shot', 'on_fire', 'nice_round', 'amazing', 'unlucky'));

alter table public.posts
  add column if not exists reaction_counts jsonb not null default '{}'::jsonb;

-- Existing likes are all great_shot now; give every post the breakdown its
-- like_count already implies.
update public.posts p
set reaction_counts = coalesce((
  select jsonb_object_agg(reaction, n)
  from (select reaction, count(*)::int as n from public.post_likes where post_id = p.id group by reaction) t
), '{}'::jsonb)
where p.like_count > 0;

-- The one trigger keeps both numbers, so they can't disagree: insert adds
-- to the total and the reaction, delete takes from both, a change of
-- reaction moves one count across and leaves the total alone. SECURITY
-- DEFINER for the same reason as in 0088 — members have no UPDATE on posts'
-- counters.
create or replace function public.post_reaction_bump(counts jsonb, key text, delta int)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select case
    when coalesce((counts->>key)::int, 0) + delta <= 0 then counts - key
    else jsonb_set(counts, array[key], to_jsonb(coalesce((counts->>key)::int, 0) + delta))
  end;
$$;
revoke all on function public.post_reaction_bump(jsonb, text, int) from public, anon, authenticated;

create or replace function public.bump_post_like_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    update public.posts
    set like_count = like_count + 1,
        reaction_counts = public.post_reaction_bump(reaction_counts, new.reaction, 1)
    where id = new.post_id;
  elsif tg_op = 'DELETE' then
    update public.posts
    set like_count = greatest(like_count - 1, 0),
        reaction_counts = public.post_reaction_bump(reaction_counts, old.reaction, -1)
    where id = old.post_id;
  elsif tg_op = 'UPDATE' and new.reaction is distinct from old.reaction then
    update public.posts
    set reaction_counts = public.post_reaction_bump(
          public.post_reaction_bump(reaction_counts, old.reaction, -1), new.reaction, 1)
    where id = new.post_id;
  end if;
  return null;
end;
$$;
revoke all on function public.bump_post_like_count() from public, anon, authenticated;

drop trigger if exists post_likes_count on public.post_likes;
create trigger post_likes_count
  after insert or delete or update of reaction on public.post_likes
  for each row execute function public.bump_post_like_count();

-- Changing your reaction: your own row, a post you can still see, and only
-- the reaction column.
grant update (reaction) on public.post_likes to authenticated;

drop policy if exists "members change their own reaction" on public.post_likes;
create policy "members change their own reaction"
  on public.post_likes for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and public.can_view_post(post_id));
