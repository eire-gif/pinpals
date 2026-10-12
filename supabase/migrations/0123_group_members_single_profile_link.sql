-- Fix for 0122 (12 Oct 2026): groups stopped loading in the app.
--
-- 0122 gave group_members.society_index_set_by a foreign key to profiles.
-- That made it the table's SECOND link to profiles (member_id is the first),
-- so every PostgREST embed written as `profile:profiles(...)` on
-- group_members became ambiguous (PGRST201) and failed — the group page,
-- My groups and the society-day roster all read members that way.
--
-- society_index_set_by is an audit field only, so it keeps the id without a
-- foreign key. Rule for the future: group_members has exactly one link to
-- profiles. supabase/tests/rls/groups.test.ts checks it.
--
-- Rollback: none needed; re-adding the key re-breaks the app.

alter table public.group_members drop constraint if exists group_members_society_index_set_by_fkey;
comment on column public.group_members.society_index_set_by is 'Who set society_index. Deliberately no foreign key: a second link to profiles makes the app''s profile:profiles(...) embeds ambiguous (PGRST201).';
notify pgrst, 'reload schema';
