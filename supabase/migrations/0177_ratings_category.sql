-- 0177 — Which course ratings a member plays off (Oct 2026)
--
-- Asked by Eire, 18 Oct 2026, after mixed tees (0176): ladies always tee off
-- the ladies' tees, so the draw should put them there by itself.
--
-- Course ratings are set separately for men and women, even off the same
-- tee — the directory has "Red" and "Red (Women)" cards side by side. So the
-- question is a golf one: "Which course ratings do you play off?" Men's,
-- Women's, or Prefer not to say. Optional, never required for anything.
--
-- 0074 deliberately kept sex and gender off `profiles`, and this keeps to
-- the spirit of it: the answer is NOT a profile column (profiles are read by
-- other members), it's in its own table that only the member can read or
-- write. The one other reader is the draw: group_ratings_categories() hands
-- the men's/women's answers of a group's members to whoever can put that
-- group on cards (anyone in a crew or trip; in a society, whoever runs its
-- events — the same rule as live_can_add_player, 0121/0144). Nothing shows
-- it on a profile, a list or a scorecard.
--
-- Deleting the account deletes it (on delete cascade).
--
-- No drop statements.
--
-- Rollback:
--   drop function if exists public.group_ratings_categories(bigint);
--   drop table if exists public.member_ratings_category;

create table if not exists public.member_ratings_category (
  member_id uuid primary key references public.profiles (id) on delete cascade,
  category text not null check (category in ('men', 'women', 'not_said')),
  updated_at timestamptz not null default now()
);

comment on table public.member_ratings_category is
  'Which course ratings a member plays off (0177): men, women or not_said. Optional. Only the member can read or write their own row; the draw reads it through group_ratings_categories().';

alter table public.member_ratings_category enable row level security;

drop policy if exists member_ratings_category_own_select on public.member_ratings_category;
create policy member_ratings_category_own_select on public.member_ratings_category
  for select to authenticated using (member_id = (select auth.uid()));

drop policy if exists member_ratings_category_own_insert on public.member_ratings_category;
create policy member_ratings_category_own_insert on public.member_ratings_category
  for insert to authenticated with check (member_id = (select auth.uid()));

drop policy if exists member_ratings_category_own_update on public.member_ratings_category;
create policy member_ratings_category_own_update on public.member_ratings_category
  for update to authenticated using (member_id = (select auth.uid())) with check (member_id = (select auth.uid()));

drop policy if exists member_ratings_category_own_delete on public.member_ratings_category;
create policy member_ratings_category_own_delete on public.member_ratings_category
  for delete to authenticated using (member_id = (select auth.uid()));

revoke all on table public.member_ratings_category from anon;
grant select, insert, update, delete on table public.member_ratings_category to authenticated;

-- For the draw: the men's / women's answers of a group's members, to whoever
-- can put the group on cards. "Prefer not to say" and no answer aren't
-- returned at all.
create or replace function public.group_ratings_categories(p_group_id bigint)
returns table (member_id uuid, category text)
language sql
stable
security definer
set search_path = public
as $$
  select r.member_id, r.category
    from public.member_ratings_category r
    join public.group_members m on m.member_id = r.member_id and m.group_id = p_group_id
   where r.category in ('men', 'women')
     and exists (
       select 1
         from public.group_members me
         join public.groups g on g.id = me.group_id
        where me.group_id = p_group_id
          and me.member_id = (select auth.uid())
          and (g.kind in ('crew', 'trip') or public.society_can(p_group_id, (select auth.uid()), 'events'))
     );
$$;
revoke all on function public.group_ratings_categories(bigint) from public, anon, authenticated;
grant execute on function public.group_ratings_categories(bigint) to authenticated;
