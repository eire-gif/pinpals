-- Pinpals: per-invite audience for tee-time invites
--
-- A host posting availability can now choose who sees it: every member
-- ("everyone", the behaviour up to now and the default) or only the members
-- they have an accepted connection with ("connections").
--
-- Enforced in RLS, not in the application. profiles.handicap_visible (0004)
-- is the counter-example: it is a plain column that every render site is
-- expected to check in TypeScript, and at least one site forgot to (see the
-- comment in src/app/community/page.tsx). "Only my connections can see this"
-- is a promise about who can read a row, and the only place that can be kept
-- is the read policy. Every caller — the browse page, the course detail page,
-- the dashboard — goes through the member's own session client, so a single
-- policy covers all of them and nothing has to remember.
--
-- The admin surface reads tee_time_invites through the service-role client,
-- which bypasses RLS, so staff continue to see every invite. That is
-- deliberate and unchanged: moderation cannot work on rows it cannot see.
--
-- Rollback:
--   drop policy if exists "View visible open invites or own invites" on public.tee_time_invites;
--   create policy "View open invites or own invites" on public.tee_time_invites
--     for select to public using ((status = 'open') or (member_id = (select auth.uid())));
--   drop policy if exists "Members can express interest" on public.tee_time_interests;
--   create policy "Members can express interest" on public.tee_time_interests
--     for insert to authenticated with check (
--       (member_id = (select auth.uid()))
--       and (exists (select 1 from tee_time_invites ti
--                    where ti.id = tee_time_interests.invite_id
--                      and ti.member_id <> (select auth.uid())
--                      and ti.status = 'open')));
--   drop function if exists public.invite_is_visible_row(text, uuid);
--   drop function if exists public.are_connected(uuid, uuid);
--   alter table public.tee_time_invites drop constraint if exists tee_time_invites_visibility_check;
--   alter table public.tee_time_invites drop column if exists visibility;

-- ============ TEE_TIME_INVITES: visibility ============
-- Defaulted to 'everyone' and NOT NULL, so every existing invite keeps
-- exactly the audience it has today and no backfill is needed. Same
-- text-plus-check shape as `status` on this table and `sale_type` on
-- listings (0035) rather than a Postgres enum, which this schema doesn't use
-- anywhere and which would make adding a third audience later an ALTER TYPE.
alter table public.tee_time_invites
  add column if not exists visibility text not null default 'everyone';

alter table public.tee_time_invites drop constraint if exists tee_time_invites_visibility_check;
alter table public.tee_time_invites
  add constraint tee_time_invites_visibility_check
  check (visibility in ('everyone', 'connections'));

-- ============ are_connected ============
-- "Do a and b have an accepted connection?" — the pair-match that until now
-- existed only inlined inside can_message() (0049) and re-derived in
-- TypeScript on three separate pages. Connections are stored one row per
-- pair with no canonical direction, hence least()/greatest(), matching the
-- unique index in 0006.
--
-- SECURITY DEFINER because the caller cannot read the row that answers the
-- question: `connections`' own SELECT policy (0028) only exposes rows the
-- caller is a party to, and asking "is the host connected to me" from inside
-- a read policy has to be answerable without granting any wider read.
-- STABLE, not VOLATILE, so the planner can call it once per row rather than
-- once per reference.
--
-- Null in, false out: least(null, x) is null, so the comparison is null and
-- exists() is false. That is the wanted answer for an anonymous visitor.
create or replace function public.are_connected(a uuid, b uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.connections c
    where c.status = 'accepted'
      and least(c.requester_id, c.recipient_id) = least(a, b)
      and greatest(c.requester_id, c.recipient_id) = greatest(a, b)
  );
$$;

revoke all on function public.are_connected(uuid, uuid) from public;
revoke execute on function public.are_connected(uuid, uuid) from anon;
grant execute on function public.are_connected(uuid, uuid) to authenticated;

-- ============ invite_is_visible_row ============
-- The audience test for one invite, as a function of that invite's own
-- column values.
--
-- Takes the values rather than an invite id, and never queries
-- tee_time_invites, for the reason 0052 documents at length: a policy on a
-- table that selects from that same table breaks INSERT ... RETURNING, and
-- supabase-js appends a RETURNING select to every insert. Posting
-- availability is exactly such an insert, so a self-querying predicate here
-- would have broken the feature it exists to support. See
-- claude/incident-listing-creation-rls-returning-bug.md.
--
-- Staff are included so that a staff member browsing the site as themselves
-- sees what the admin surface shows; it mirrors listing_is_visible_row().
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
    target_member_id = auth.uid()
    or target_visibility = 'everyone'
    or public.is_staff()
    or public.are_connected(auth.uid(), target_member_id);
$$;

revoke all on function public.invite_is_visible_row(text, uuid) from public;
grant execute on function public.invite_is_visible_row(text, uuid) to anon, authenticated;

-- ============ RLS: who can read an invite ============
-- Renamed from "View open invites or own invites" (0028) because the old
-- name no longer describes what it does. The status half is unchanged and
-- still first; the audience test is ANDed onto it, so an invite has to pass
-- both — open (or yours), and addressed to you.
drop policy if exists "View open invites or own invites" on public.tee_time_invites;
drop policy if exists "View visible open invites or own invites" on public.tee_time_invites;
create policy "View visible open invites or own invites"
  on public.tee_time_invites
  for select
  to public
  using (
    ((status = 'open') or (member_id = (select auth.uid())))
    and public.invite_is_visible_row(visibility, member_id)
  );

-- ============ RLS: who can express interest ============
-- This policy re-derives eligibility from the invite rather than trusting
-- that the caller could see it, so it needs the audience test too. Without
-- it, a member who is not connected to the host could still join a
-- connections-only round by posting an invite id they never saw on screen —
-- ids are sequential, so that is guessing, not hacking.
drop policy if exists "Members can express interest" on public.tee_time_interests;
create policy "Members can express interest"
  on public.tee_time_interests
  for insert
  to authenticated
  with check (
    (member_id = (select auth.uid()))
    and (exists (
      select 1
      from public.tee_time_invites ti
      where ti.id = tee_time_interests.invite_id
        and ti.member_id <> (select auth.uid())
        and ti.status = 'open'
        and public.invite_is_visible_row(ti.visibility, ti.member_id)
    ))
  );

-- No index on `visibility`: two values across a small table, and every query
-- that touches it already filters on status/play_date/county first. An index
-- here would be write cost for no read gain.
