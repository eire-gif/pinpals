-- Pinpals: let a confirmed golfer see who else is in the fourball.
--
-- Until now the SELECT policy on tee_time_interests (0004, rewritten in 0028)
-- said: you may read your own interest, or any interest on an invite you host.
-- That is right for a negotiation — who else has asked to join is the host's
-- business, not an applicant's — but it does not survive the negotiation
-- ending. Four golfers who have all confirmed a place in the same round still
-- could not see each other; each one saw a club, a date, and the host's name.
--
-- Confirming a place is the moment that changes. You have agreed to spend four
-- hours with these people; knowing their names is not a privacy leak, it is the
-- point.
--
-- ============ What this widens, precisely ============
--
-- A member may now also read an interest row when BOTH hold:
--
--   * that row's status is 'confirmed', and
--   * the reader themselves has a confirmed place on the same invite.
--
-- Pending and declined requests stay invisible to everyone but the applicant
-- and the host — a golfer who asked and was turned down has not joined
-- anything, and the other players have no business seeing that they tried.
-- Someone who has merely been *offered* a place ('accepted') cannot see the
-- list either; they see it once they confirm, which is also when they become
-- part of it.
--
-- The information this exposes is the ASSOCIATION — these members are playing
-- this round together — not the members themselves. Names, home clubs and
-- handicaps are already readable by every signed-in member through the
-- directory (`profiles`' own SELECT policy, 0001).
--
-- ============ Why a SECURITY DEFINER function ============
--
-- The new clause has to ask a question about tee_time_interests from inside a
-- policy ON tee_time_interests. Written inline as an `exists (select 1 from
-- tee_time_interests ...)` that is infinite recursion: evaluating the policy
-- runs the subquery, which evaluates the policy. Postgres catches it and
-- raises, so it would fail loudly rather than leak — but it would fail on
-- every read of the table.
--
-- A SECURITY DEFINER function runs as the owner, for whom RLS does not apply,
-- so the inner read is a plain query and the recursion never starts. Same
-- shape as invite_is_visible_row() in 0065, and for the same reason.
--
-- The function is safe to expose to signed-in members: it takes an invite id
-- and answers only about the CALLER's own confirmed status (auth.uid() is
-- baked in, not a parameter), so calling it for someone else's round tells you
-- nothing you did not already know about yourself.

create or replace function public.has_confirmed_place(target_invite_id bigint)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.tee_time_interests i
    where i.invite_id = target_invite_id
      and i.member_id = auth.uid()
      and i.status = 'confirmed'
  );
$$;

-- Revoked BY NAME, not just from the PUBLIC pseudo-role. Supabase's default
-- privileges grant execute on every new function to anon and authenticated
-- explicitly, and `revoke ... from public` does not touch an explicit
-- per-role grant — that is exactly how notify_user() became anon-callable in
-- 0075. See claude/incident-notify-user-grants-after-recreate.md and the
-- header of supabase/tests/rls/function-grants.test.ts.
revoke all on function public.has_confirmed_place(bigint) from public, anon, authenticated;
grant execute on function public.has_confirmed_place(bigint) to authenticated;

-- ============ The policy ============
--
-- The first two clauses are 0028's, unchanged and in the same order: the
-- overwhelmingly common reads are "my own row" and "a row on my own invite",
-- and both are settled without calling the function at all.
--
-- This also keeps INSERT ... RETURNING working. supabase-js appends a
-- RETURNING select to every insert, so the SELECT policy is evaluated against
-- the row just written — see migration 0052 and
-- claude/incident-listing-creation-rls-returning-bug.md for the time that
-- broke listing creation. A freshly inserted interest has
-- member_id = auth.uid() and status 'pending', so it passes on the first
-- clause and never reaches the third.
drop policy if exists "See own interest or interest on your invites" on public.tee_time_interests;
create policy "See own interest or interest on your invites"
  on public.tee_time_interests
  for select to authenticated
  using (
    (member_id = (select auth.uid()))
    or (exists (
      select 1 from public.tee_time_invites ti
      where ti.id = tee_time_interests.invite_id
        and ti.member_id = (select auth.uid())
    ))
    or (status = 'confirmed' and public.has_confirmed_place(invite_id))
  );

comment on function public.has_confirmed_place(bigint) is
  'Whether the calling member has a confirmed place on this invite. Exists so the tee_time_interests SELECT policy can ask a question about its own table without recursing — see 0078.';
