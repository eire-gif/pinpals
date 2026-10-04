-- Saved posts: the feed card's Save action (Oct 2026 feed redesign, phase 1).
--
-- A private bookmark, like listing_favourites (0037) is for the marketplace:
-- one row per (post, member), readable and removable only by the member who
-- saved it. Unlike a like, saving is not a public act — nobody, the post's
-- author included, can see who saved their post, and the author is not
-- notified. That is also why it has no counter column on posts.
--
-- Written straight from the app and the site with the member's own session,
-- as listing_favourites is: there is nothing to notify and nothing a server
-- needs to do, so a route would only be a second place for the rule to live.
--
-- You can only save what you can see (can_view_post, 0088). A saved post
-- that later becomes invisible to you — the author blocks you, deletes it,
-- or narrows it to connections — keeps its save row, but the post itself no
-- longer comes back through posts' RLS, so it silently drops out of your
-- saved list. The row goes with the post on delete.
--
-- Rollback: drop table if exists public.post_saves;

create table if not exists public.post_saves (
  post_id bigint not null references public.posts (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

-- "Which of these posts have I saved" per feed page, and "my saved posts,
-- newest first".
create index if not exists post_saves_user_idx on public.post_saves (user_id, created_at desc);

alter table public.post_saves enable row level security;
revoke update, truncate, references, trigger on public.post_saves from anon, authenticated;
revoke all on public.post_saves from anon;
grant select, insert, delete on public.post_saves to authenticated;

drop policy if exists "members read their own saves" on public.post_saves;
create policy "members read their own saves"
  on public.post_saves for select
  to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "members save posts they can see" on public.post_saves;
create policy "members save posts they can see"
  on public.post_saves for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and public.can_view_post(post_id)
  );

drop policy if exists "members remove their own saves" on public.post_saves;
create policy "members remove their own saves"
  on public.post_saves for delete
  to authenticated
  using (user_id = (select auth.uid()));
