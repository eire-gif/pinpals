-- Pinpals: invite_is_visible_row() must answer false, never null
--
-- 0065 shipped this predicate as a bare OR chain starting with
-- `target_member_id = auth.uid()`. For a signed-out visitor auth.uid() is
-- null, so that first comparison is null, and `null or false or false or
-- false` is null — the function returned null rather than false when asked
-- whether an anonymous visitor could see a connections-only invite.
--
-- Nothing was exposed. A USING clause treats null as false, so the row was
-- correctly hidden, and the same is true of the exists() in the interest
-- policy. This is a correctness fix on the function's own contract, not a
-- security fix: a boolean function named "is visible" that returns null is a
-- trap for the next caller, who may reasonably write `= false` or read it
-- from TypeScript, where null is not false.
--
-- Only the first branch needs coalescing. `target_visibility = 'everyone'`
-- compares two non-null values, is_staff() returns a real boolean, and
-- are_connected() wraps an exists(), which is never null.
--
-- Rollback: re-apply the function body as written in
-- 0065_tee_time_invite_visibility.sql.

create or replace function public.invite_is_visible_row(
  target_visibility text,
  target_member_id uuid
)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select
    coalesce(target_member_id = auth.uid(), false)
    or target_visibility = 'everyone'
    or public.is_staff()
    or public.are_connected(auth.uid(), target_member_id);
$$;
