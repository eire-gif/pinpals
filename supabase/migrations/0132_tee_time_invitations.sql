-- Filling an open place: invite a PinPal, or share a link (13 Oct 2026).
-- Design: claude/tee-time-invitations.md.
--
-- WHAT CHANGES
--
--   - The host, or anyone with a confirmed place, can invite PinPals members
--     to a round that still has space. The member is told, and can see the
--     round even when it is for the host's connections only.
--   - Anyone with a link a host or player shared (/t/<token>, signed by the
--     website) is added the same way when they open it signed in.
--   - Saying yes is unchanged: the invited golfer taps "I'm interested" and
--     the host offers the place, as for any request.
--
-- WHO SEES WHAT
--
--   - An invitation: the member invited, whoever invited them, and the host.
--   - Every write goes through the functions below.
--
-- Rollback:
--   restore 0065's two policies ("View visible open invites or own invites"
--   on tee_time_invites, "Members can express interest" on
--   tee_time_interests), then
--   drop table if exists public.tee_time_invitations;
--   drop function if exists public.tee_time_invited(bigint), public.tee_time_can_fill(bigint, uuid),
--     public.invite_to_tee_time(bigint, uuid[]), public.tee_time_link_claim(bigint, uuid, uuid);


-- ============ Table ============

create table if not exists public.tee_time_invitations (
  invite_id bigint not null references public.tee_time_invites (id) on delete cascade,
  member_id uuid not null references public.profiles (id) on delete cascade,
  -- Who asked them. No foreign key to profiles on purpose (the 0123 lesson).
  invited_by uuid not null,
  -- 'member': picked in the app. 'link': opened a shared link.
  via text not null default 'member' check (via in ('member', 'link')),
  created_at timestamptz not null default now(),
  primary key (invite_id, member_id)
);
create index if not exists tee_time_invitations_member_idx on public.tee_time_invitations (member_id);

alter table public.tee_time_invitations enable row level security;

drop policy if exists "invited, inviter or host read invitations" on public.tee_time_invitations;
create policy "invited, inviter or host read invitations" on public.tee_time_invitations
  for select to authenticated
  using (
    member_id = (select auth.uid())
    or invited_by = (select auth.uid())
    or exists (select 1 from public.tee_time_invites ti where ti.id = invite_id and ti.member_id = (select auth.uid()))
  );

revoke all on public.tee_time_invitations from anon, authenticated;
grant select on public.tee_time_invitations to authenticated;


-- ============ Helpers ============

-- You were invited to this round.
create or replace function public.tee_time_invited(p_invite_id bigint)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.tee_time_invitations
     where invite_id = p_invite_id and member_id = (select auth.uid())
  );
$$;
revoke all on function public.tee_time_invited(bigint) from public, anon, authenticated;
grant execute on function public.tee_time_invited(bigint) to authenticated;

-- The host, or a golfer with a confirmed place: who may bring someone in.
create or replace function public.tee_time_can_fill(p_invite_id bigint, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.tee_time_invites where id = p_invite_id and member_id = p_user)
      or exists (select 1 from public.tee_time_interests where invite_id = p_invite_id and member_id = p_user and status = 'confirmed');
$$;
revoke all on function public.tee_time_can_fill(bigint, uuid) from public, anon, authenticated;
grant execute on function public.tee_time_can_fill(bigint, uuid) to authenticated, service_role;


-- ============ Seeing and joining a round you were invited to ============

-- 0065's, with "or you were invited" beside the audience test.
drop policy if exists "View visible open invites or own invites" on public.tee_time_invites;
create policy "View visible open invites or own invites"
  on public.tee_time_invites
  for select
  to public
  using (
    ((status = 'open') or (member_id = (select auth.uid())))
    and (public.invite_is_visible_row(visibility, member_id) or public.tee_time_invited(id))
  );

drop policy if exists "Members can express interest" on public.tee_time_interests;
create policy "Members can express interest"
  on public.tee_time_interests
  for insert
  to authenticated
  with check (
    member_id = (select auth.uid())
    and exists (
      select 1 from public.tee_time_invites ti
       where ti.id = invite_id
         and ti.member_id <> (select auth.uid())
         and ti.status = 'open'
         and (public.invite_is_visible_row(ti.visibility, ti.member_id) or public.tee_time_invited(ti.id))
    )
  );


-- ============ Inviting ============

-- Returns the members newly invited — the ones to tell. Anyone already in
-- the round, already asked, already invited, blocked either way, or the
-- host is skipped without fuss: the caller only needs to know who to tell.
create or replace function public.invite_to_tee_time(p_invite_id bigint, p_members uuid[])
returns setof uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := (select auth.uid());
  t public.tee_time_invites%rowtype;
  v_member uuid;
begin
  select * into t from public.tee_time_invites where id = p_invite_id;
  if not found or not public.tee_time_can_fill(p_invite_id, me) then
    raise exception 'Only the host or someone playing can invite people.' using errcode = '42501';
  end if;
  if t.status <> 'open' or t.spaces_available < 1 then raise exception 'This round is full.'; end if;
  if t.play_date < (now() at time zone 'Europe/Dublin')::date then raise exception 'This round has been played.'; end if;
  if p_members is null or cardinality(p_members) = 0 then return; end if;
  if cardinality(p_members) > 20 then raise exception 'Invite up to 20 people at a time.'; end if;

  foreach v_member in array p_members loop
    continue when v_member is null or v_member = me or v_member = t.member_id;
    continue when not exists (select 1 from public.profiles where id = v_member);
    continue when public.is_blocked(me, v_member) or public.is_blocked(t.member_id, v_member);
    continue when exists (select 1 from public.tee_time_interests where invite_id = p_invite_id and member_id = v_member);
    insert into public.tee_time_invitations (invite_id, member_id, invited_by, via)
    values (p_invite_id, v_member, me, 'member')
    on conflict (invite_id, member_id) do nothing;
    if found then return next v_member; end if;
  end loop;
end;
$$;
revoke all on function public.invite_to_tee_time(bigint, uuid[]) from public, anon, authenticated;
grant execute on function public.invite_to_tee_time(bigint, uuid[]) to authenticated;

-- A shared link opened by a signed-in member. The website calls this with
-- the service role once it has checked the link's signature; it is never
-- reachable from the app directly. True when the member can now see the
-- round (newly invited, already invited, or already in it).
create or replace function public.tee_time_link_claim(p_invite_id bigint, p_sharer uuid, p_member uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.tee_time_invites%rowtype;
begin
  select * into t from public.tee_time_invites where id = p_invite_id;
  if not found or t.status <> 'open' then return false; end if;
  if t.play_date < (now() at time zone 'Europe/Dublin')::date then return false; end if;
  if p_member = t.member_id then return true; end if;
  if exists (select 1 from public.tee_time_interests where invite_id = p_invite_id and member_id = p_member) then return true; end if;
  if exists (select 1 from public.tee_time_invitations where invite_id = p_invite_id and member_id = p_member) then return true; end if;
  -- The sharer must still be the host or playing, and nobody blocked.
  if not public.tee_time_can_fill(p_invite_id, p_sharer) then return false; end if;
  if public.is_blocked(p_sharer, p_member) or public.is_blocked(t.member_id, p_member) then return false; end if;
  insert into public.tee_time_invitations (invite_id, member_id, invited_by, via)
  values (p_invite_id, p_member, p_sharer, 'link')
  on conflict (invite_id, member_id) do nothing;
  return true;
end;
$$;
revoke all on function public.tee_time_link_claim(bigint, uuid, uuid) from public, anon, authenticated;
grant execute on function public.tee_time_link_claim(bigint, uuid, uuid) to service_role;
