-- ============================================================================
-- Groups, step B (Oct 2026): groups, their members, invitations and requests
-- ============================================================================
--
-- The design is claude/groups-architecture.md; the shared rules are
-- src/lib/groups.ts (byte-identical in mobile/src/lib/). This is step B of
-- that plan: the groups themselves and who is in them. NOTHING ELSE CHANGES.
-- No existing policy, function or table is touched — posts, tee times and
-- live rounds don't know groups exist yet. Pointing them at a group as an
-- audience is steps C and D, each its own reviewed change, because that is
-- where a policy one clause too generous would leak (the "members, or
-- connected" trap in the architecture doc).
--
-- WHAT A MEMBER CAN START (decision, 11 Oct 2026): crews, trips and
-- societies. Local (county) and club groups exist in the model and the kind
-- check below, but create_group() refuses them until staff moderation and
-- one-per-county / one-per-club seeding are built.
--
-- SOCIETIES are new to the model: 'request' privacy, so they show in search
-- and golfers ask to join, with the owner (the secretary) and admins (the
-- committee) approving. No group chat — most are 30–60 golfers and 0087's
-- group chats hold 20.
--
-- EVERY WRITE GOES THROUGH A FUNCTION BELOW. Members have SELECT on these
-- tables and nothing else. Being in a group will soon decide what you can see
-- (steps C, D), so who gets in must be decided in one place, with the
-- capacity, block and permission checks applied every time.
--
-- INVITE LINKS. A group has an optional eight-character code; the link is
-- pinpals.ie/join/g/<code> (the AASA already claims /join/*). Whoever may
-- invite can fetch it, and anyone holding it joins straight in — no queue,
-- because a secretary posting the link in the society's WhatsApp group IS
-- the approval. The code is never readable from the table itself (column
-- grants), only through group_invite_code(), and an admin can reset it.
--
-- BLOCKS follow the architecture doc: a block either way between you and the
-- owner or an admin closes the door (no join, no invite, no request). Two
-- ordinary members who have blocked each other may both belong; in the group
-- chat the later joiner is simply not added, because 0087's rule is that any
-- block in a conversation stops everyone posting.
--
-- ACCOUNT DELETION. Memberships cascade with the profile. If the owner goes,
-- the longest-serving admin takes over, else the longest-serving member; a
-- group nobody is left in is deleted. Same trigger handles an owner removed
-- any other way.
--
-- Rollback: drop the three tables and the functions below. Nothing else
-- references them yet.


-- ============ GROUPS ============

create table if not exists public.groups (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('crew', 'area', 'club', 'trip', 'society')),
  name text not null check (char_length(btrim(name)) between 1 and 60),
  about text check (about is null or char_length(about) <= 500),
  privacy text not null check (privacy in ('open', 'request', 'invite')),
  features text[] not null default '{}'
    check (features <@ array['posts', 'events', 'polls', 'chat', 'tee_times']::text[]),
  members_can_post boolean not null default true,
  members_can_invite boolean not null default true,
  -- A society's home club, or (later) a club group's club.
  club_id bigint references public.clubs (id) on delete set null,
  -- A trip's dates.
  starts_on date,
  ends_on date,
  -- The group chat (0087), once the group has three people. Crews and trips only.
  conversation_id bigint unique references public.conversations (id) on delete set null,
  invite_code text unique check (invite_code is null or invite_code ~ '^[a-z0-9]{8}$'),
  member_count integer not null default 0,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  -- Moderation: a hidden group is gone for everyone.
  hidden_at timestamptz,
  constraint groups_trip_dates_check check (ends_on is null or starts_on is null or ends_on >= starts_on)
);

-- "Find a society": the search screen filters on these two and orders by name.
create index if not exists groups_searchable_idx
  on public.groups (privacy, name)
  where hidden_at is null;

alter table public.groups enable row level security;


-- ============ GROUP_MEMBERS ============

create table if not exists public.group_members (
  group_id bigint not null references public.groups (id) on delete cascade,
  member_id uuid not null references public.profiles (id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'admin', 'member')),
  joined_at timestamptz not null default now(),
  -- Notifications only; nothing else reads it.
  muted boolean not null default false,
  primary key (group_id, member_id)
);

-- One owner per group. A transfer demotes the old owner before promoting the
-- new one, so this never trips mid-transfer.
create unique index if not exists group_members_one_owner
  on public.group_members (group_id)
  where role = 'owner';

-- "Which groups am I in": the Groups screen and Home, read the other way
-- round from the primary key.
create index if not exists group_members_member_idx on public.group_members (member_id);

alter table public.group_members enable row level security;


-- ============ GROUP_INVITATIONS ============
--
-- Invitations and join requests in one table: the same shape in opposite
-- directions, and one row per person per group, so "invited AND requested"
-- can't exist as two disagreeing rows. A row is kept after it's answered —
-- status says how — so a member who was declined can't re-request in a loop
-- (see request_to_join_group).

create table if not exists public.group_invitations (
  id bigint generated always as identity primary key,
  group_id bigint not null references public.groups (id) on delete cascade,
  member_id uuid not null references public.profiles (id) on delete cascade,
  direction text not null check (direction in ('invite', 'request')),
  invited_by uuid references public.profiles (id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  unique (group_id, member_id)
);

create index if not exists group_invitations_member_idx
  on public.group_invitations (member_id)
  where status = 'pending';

alter table public.group_invitations enable row level security;


-- ============ Helpers the policies use ============
--
-- SECURITY DEFINER so a policy on one table can ask about another without
-- recursing through that table's own policy. coalesce(…, false): an unknown
-- answer is a no (the 0066 lesson).

create or replace function public.is_group_member(p_group_id bigint, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select true from public.group_members m
    where m.group_id = p_group_id and m.member_id = p_user_id
  ), false);
$$;
revoke all on function public.is_group_member(bigint, uuid) from public, anon, authenticated;
grant execute on function public.is_group_member(bigint, uuid) to authenticated;

create or replace function public.group_role(p_group_id bigint, p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select m.role from public.group_members m
  where m.group_id = p_group_id and m.member_id = p_user_id;
$$;
revoke all on function public.group_role(bigint, uuid) from public, anon, authenticated;
grant execute on function public.group_role(bigint, uuid) to authenticated;


-- ============ Policies ============

-- A searchable (request) or open group's front page is visible to every
-- signed-in member: that is what lets a golfer find a society. An invite-only
-- group is visible only to its members and to whoever has a pending
-- invitation to it. Hidden groups are visible to nobody.
drop policy if exists "groups are visible to members, invitees, or when searchable" on public.groups;
create policy "groups are visible to members, invitees, or when searchable"
  on public.groups for select
  to authenticated
  using (
    hidden_at is null
    and (
      privacy in ('open', 'request')
      or public.is_group_member(id, (select auth.uid()))
      or exists (
        select 1 from public.group_invitations i
        where i.group_id = groups.id
          and i.member_id = (select auth.uid())
          and i.direction = 'invite'
          and i.status = 'pending'
      )
    )
  );

-- Every column except invite_code. The code is a key to the group; it comes
-- only from group_invite_code(), to people who may invite.
revoke all on public.groups from anon, authenticated;
grant select (
  id, kind, name, about, privacy, features, members_can_post, members_can_invite,
  club_id, starts_on, ends_on, conversation_id, member_count, created_by, created_at, hidden_at
) on public.groups to authenticated;

-- Who is in a group is for its members. A non-member sees the count on the
-- front page and nothing more.
drop policy if exists "group members are visible to the group" on public.group_members;
create policy "group members are visible to the group"
  on public.group_members for select
  to authenticated
  using (public.is_group_member(group_id, (select auth.uid())));

revoke all on public.group_members from anon, authenticated;
grant select on public.group_members to authenticated;

-- Your own invitations and requests; the whole queue for owner and admins;
-- and the invitations you sent.
drop policy if exists "group invitations are visible to the people involved" on public.group_invitations;
create policy "group invitations are visible to the people involved"
  on public.group_invitations for select
  to authenticated
  using (
    member_id = (select auth.uid())
    or invited_by = (select auth.uid())
    or public.group_role(group_id, (select auth.uid())) in ('owner', 'admin')
  );

revoke all on public.group_invitations from anon, authenticated;
grant select on public.group_invitations to authenticated;


-- ============ Internal steps (no grants: called only from the functions below) ============

-- How many a group of this kind may hold. Mirrors GROUP_KIND_INFO.maxMembers.
create or replace function public.group_capacity(p_kind text)
returns integer
language sql
immutable
set search_path = public
as $$
  select case p_kind
    when 'crew' then 20
    when 'trip' then 20
    when 'society' then 500
    else 2000
  end;
$$;
revoke all on function public.group_capacity(text) from public, anon, authenticated;

-- A block either way between this person and the owner or any admin.
create or replace function public.group_blocked_by_admins(p_group_id bigint, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select true from public.group_members m
    where m.group_id = p_group_id
      and m.role in ('owner', 'admin')
      and m.member_id <> p_user_id
      and public.is_blocked(m.member_id, p_user_id)
    limit 1
  ), false);
$$;
revoke all on function public.group_blocked_by_admins(bigint, uuid) from public, anon, authenticated;

-- Puts someone in a group after the checks every way in shares: the group is
-- there and not hidden, they aren't blocked by whoever runs it, and there is
-- room. Marks any invitation or request of theirs as accepted. Returns false
-- if they were already in.
create or replace function public.group_add_member(p_group_id bigint, p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  g public.groups%rowtype;
begin
  -- Locks the group row: two people taking the last place at once queue here.
  select * into g from public.groups where id = p_group_id for update;
  if not found or g.hidden_at is not null then
    raise exception 'That group no longer exists.';
  end if;
  if public.is_group_member(p_group_id, p_user_id) then
    return false;
  end if;
  if not exists (select 1 from public.profiles p where p.id = p_user_id and p.deleted_at is null) then
    raise exception 'That golfer isn''t on PinPals any more.';
  end if;
  if public.group_blocked_by_admins(p_group_id, p_user_id) then
    raise exception 'You can''t join this group.';
  end if;
  if g.member_count >= public.group_capacity(g.kind) then
    raise exception 'This group is full — % members at most.', public.group_capacity(g.kind);
  end if;

  insert into public.group_members (group_id, member_id, role) values (p_group_id, p_user_id, 'member');

  update public.group_invitations
     set status = 'accepted', responded_at = now()
   where group_id = p_group_id and member_id = p_user_id and status = 'pending';
  return true;
end;
$$;
revoke all on function public.group_add_member(bigint, uuid) from public, anon, authenticated;

-- Keeps a crew's or trip's group chat in step with its members.
--
-- The chat starts once the group has three people (a 0087 group needs three:
-- two is a direct conversation). Members are added in the order they joined,
-- and anyone with a block against someone already in the chat is left out of
-- it — 0087 stops everyone posting in a conversation that contains a block,
-- so adding them would silence the whole chat. Anyone no longer in the group
-- is taken out.
create or replace function public.group_sync_chat(p_group_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  g public.groups%rowtype;
  v_owner uuid;
  v_conversation bigint;
  r record;
begin
  select * into g from public.groups where id = p_group_id;
  if not found or not ('chat' = any (g.features)) then
    return;
  end if;

  v_conversation := g.conversation_id;
  if v_conversation is null then
    if g.member_count < 3 or g.member_count > 20 then
      return;
    end if;
    select member_id into v_owner from public.group_members where group_id = p_group_id and role = 'owner';
    insert into public.conversations (kind, title, created_by)
    values ('group', g.name, v_owner)
    returning id into v_conversation;
    update public.groups set conversation_id = v_conversation where id = p_group_id;
  end if;

  delete from public.conversation_members cm
   where cm.conversation_id = v_conversation
     and not exists (
       select 1 from public.group_members m
       where m.group_id = p_group_id and m.member_id = cm.member_id
     );

  for r in
    select m.member_id, m.role from public.group_members m
    where m.group_id = p_group_id
      and not exists (
        select 1 from public.conversation_members cm
        where cm.conversation_id = v_conversation and cm.member_id = m.member_id
      )
    order by (m.role = 'owner') desc, m.joined_at
  loop
    if exists (
      select 1 from public.conversation_members cm
      where cm.conversation_id = v_conversation
        and public.is_blocked(cm.member_id, r.member_id)
    ) then
      continue;
    end if;
    insert into public.conversation_members (conversation_id, member_id, role)
    values (
      v_conversation,
      r.member_id,
      -- Only the chat's creator holds 0087's 'owner'; there is exactly one.
      case when not exists (
        select 1 from public.conversation_members cm
        where cm.conversation_id = v_conversation and cm.role = 'owner'
      ) and r.role = 'owner' then 'owner' else 'member' end
    )
    on conflict do nothing;
  end loop;
end;
$$;
revoke all on function public.group_sync_chat(bigint) from public, anon, authenticated;


-- ============ Trigger: counts, succession, chat ============

create or replace function public.group_members_after_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group bigint := coalesce(new.group_id, old.group_id);
  v_heir uuid;
begin
  -- Deleting the group cascades here; there is nothing left to keep in step.
  if not exists (select 1 from public.groups where id = v_group) then
    return null;
  end if;

  update public.groups g
     set member_count = (select count(*) from public.group_members m where m.group_id = v_group)
   where g.id = v_group;

  if tg_op = 'DELETE' and old.role = 'owner' then
    select m.member_id into v_heir
      from public.group_members m
     where m.group_id = v_group
     order by (m.role = 'admin') desc, m.joined_at
     limit 1;
    if v_heir is null then
      delete from public.groups where id = v_group;
      return null;
    end if;
    update public.group_members set role = 'owner' where group_id = v_group and member_id = v_heir;
  end if;

  perform public.group_sync_chat(v_group);
  return null;
end;
$$;
revoke all on function public.group_members_after_change() from public, anon, authenticated;

drop trigger if exists group_members_after_change on public.group_members;
create trigger group_members_after_change
  after insert or delete on public.group_members
  for each row
  execute function public.group_members_after_change();


-- ============ Creating a group ============

create or replace function public.create_group(
  p_kind text,
  p_name text,
  p_about text default null,
  p_club_id bigint default null,
  p_starts_on date default null,
  p_ends_on date default null
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := (select auth.uid());
  v_name text := btrim(coalesce(p_name, ''));
  v_about text := nullif(btrim(coalesce(p_about, '')), '');
  v_id bigint;
begin
  if me is null then
    raise exception 'Sign in to start a group.' using errcode = '42501';
  end if;
  -- CREATABLE_GROUP_KINDS in src/lib/groups.ts.
  if p_kind is null or p_kind not in ('crew', 'trip', 'society') then
    raise exception 'You can start a crew, a trip or a society.';
  end if;
  if char_length(v_name) = 0 then
    raise exception 'Give the group a name.';
  end if;
  if char_length(v_name) > 60 then
    raise exception 'That name is too long — 60 characters at most.';
  end if;
  if v_name ~* '^pinpals\M' then
    raise exception 'Group names can''t start with PinPals.';
  end if;
  if v_about is not null and char_length(v_about) > 500 then
    raise exception 'The description is too long — 500 characters at most.';
  end if;
  if p_starts_on is not null and p_ends_on is not null and p_ends_on < p_starts_on then
    raise exception 'The trip can''t end before it starts.';
  end if;
  -- A brake on scripts, far above any real use.
  if (select count(*) from public.group_members where member_id = me and role = 'owner') >= 25 then
    raise exception 'You run 25 groups already — that''s the most one member can start.';
  end if;

  -- Defaults per kind: GROUP_KIND_INFO in src/lib/groups.ts.
  insert into public.groups (kind, name, about, privacy, features, club_id, starts_on, ends_on, created_by)
  values (
    p_kind,
    v_name,
    v_about,
    case p_kind when 'society' then 'request' else 'invite' end,
    case p_kind
      when 'society' then array['posts', 'events', 'polls', 'tee_times']
      else array['posts', 'events', 'polls', 'chat', 'tee_times']
    end,
    p_club_id,
    case when p_kind = 'trip' then p_starts_on end,
    case when p_kind = 'trip' then p_ends_on end,
    me
  )
  returning id into v_id;

  insert into public.group_members (group_id, member_id, role) values (v_id, me, 'owner');
  return v_id;
end;
$$;
revoke all on function public.create_group(text, text, text, bigint, date, date) from public, anon, authenticated;
grant execute on function public.create_group(text, text, text, bigint, date, date) to authenticated;


-- ============ Editing and deleting ============

create or replace function public.update_group(
  p_group_id bigint,
  p_name text,
  p_about text,
  p_members_can_invite boolean,
  p_club_id bigint default null,
  p_starts_on date default null,
  p_ends_on date default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := (select auth.uid());
  v_name text := btrim(coalesce(p_name, ''));
  v_about text := nullif(btrim(coalesce(p_about, '')), '');
  v_kind text;
  v_conversation bigint;
begin
  if coalesce(public.group_role(p_group_id, me), '') not in ('owner', 'admin') then
    raise exception 'Only whoever runs the group can change it.';
  end if;
  if char_length(v_name) = 0 then
    raise exception 'Give the group a name.';
  end if;
  if char_length(v_name) > 60 then
    raise exception 'That name is too long — 60 characters at most.';
  end if;
  if v_name ~* '^pinpals\M' then
    raise exception 'Group names can''t start with PinPals.';
  end if;
  if v_about is not null and char_length(v_about) > 500 then
    raise exception 'The description is too long — 500 characters at most.';
  end if;
  if p_starts_on is not null and p_ends_on is not null and p_ends_on < p_starts_on then
    raise exception 'The trip can''t end before it starts.';
  end if;

  update public.groups
     set name = v_name,
         about = v_about,
         members_can_invite = coalesce(p_members_can_invite, members_can_invite),
         club_id = p_club_id,
         starts_on = case when kind = 'trip' then p_starts_on end,
         ends_on = case when kind = 'trip' then p_ends_on end
   where id = p_group_id
   returning kind, conversation_id into v_kind, v_conversation;

  -- The chat keeps the group's name.
  if v_conversation is not null then
    update public.conversations set title = v_name where id = v_conversation;
  end if;
end;
$$;
revoke all on function public.update_group(bigint, text, text, boolean, bigint, date, date) from public, anon, authenticated;
grant execute on function public.update_group(bigint, text, text, boolean, bigint, date, date) to authenticated;

-- The owner only. The group chat, if there was one, stays as an ordinary
-- group chat: its messages are its members' as much as the owner's.
create or replace function public.delete_group(p_group_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(public.group_role(p_group_id, (select auth.uid())), '') <> 'owner' then
    raise exception 'Only the group''s owner can delete it.';
  end if;
  delete from public.groups where id = p_group_id;
end;
$$;
revoke all on function public.delete_group(bigint) from public, anon, authenticated;
grant execute on function public.delete_group(bigint) to authenticated;


-- ============ Invitations ============

-- Invites the caller's connections. Returns how many were invited (or, for
-- someone who had already asked to join and an admin is inviting, added).
-- Anyone who can't be invited is skipped rather than failing the whole list:
-- already in, not connected, blocked, gone.
create or replace function public.invite_to_group(p_group_id bigint, p_member_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := (select auth.uid());
  v_role text := public.group_role(p_group_id, (select auth.uid()));
  g public.groups%rowtype;
  v_id uuid;
  v_row public.group_invitations%rowtype;
  v_done integer := 0;
begin
  select * into g from public.groups where id = p_group_id;
  if not found or g.hidden_at is not null then
    raise exception 'That group no longer exists.';
  end if;
  if v_role is null or (v_role = 'member' and not g.members_can_invite) then
    raise exception 'Only whoever runs this group can invite people to it.';
  end if;
  if coalesce(array_length(p_member_ids, 1), 0) > 50 then
    raise exception 'Invite up to 50 people at a time.';
  end if;

  for v_id in select distinct x from unnest(coalesce(p_member_ids, '{}'::uuid[])) as t(x) where x is not null loop
    continue when v_id = me
      or public.is_group_member(p_group_id, v_id)
      or not public.are_connected(me, v_id)
      or public.is_blocked(me, v_id)
      or public.group_blocked_by_admins(p_group_id, v_id)
      or not exists (select 1 from public.profiles p where p.id = v_id and p.deleted_at is null);

    select * into v_row from public.group_invitations where group_id = p_group_id and member_id = v_id;

    if found and v_row.direction = 'request' and v_row.status = 'pending' and v_role in ('owner', 'admin') then
      -- They asked; someone who can approve is inviting them. That's a yes.
      if public.group_add_member(p_group_id, v_id) then
        v_done := v_done + 1;
      end if;
    elsif found and v_row.direction = 'invite' and v_row.status = 'pending' then
      -- Already invited. Nothing to do, and no second notification.
      continue;
    elsif found then
      update public.group_invitations
         set direction = 'invite', invited_by = me, status = 'pending', created_at = now(), responded_at = null
       where id = v_row.id;
      v_done := v_done + 1;
    else
      insert into public.group_invitations (group_id, member_id, direction, invited_by)
      values (p_group_id, v_id, 'invite', me);
      v_done := v_done + 1;
    end if;
  end loop;

  return v_done;
end;
$$;
revoke all on function public.invite_to_group(bigint, uuid[]) from public, anon, authenticated;
grant execute on function public.invite_to_group(bigint, uuid[]) to authenticated;

create or replace function public.respond_group_invitation(p_group_id bigint, p_accept boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := (select auth.uid());
begin
  if not exists (
    select 1 from public.group_invitations
    where group_id = p_group_id and member_id = me and direction = 'invite' and status = 'pending'
  ) then
    raise exception 'That invitation has already been answered or withdrawn.';
  end if;

  if coalesce(p_accept, false) then
    perform public.group_add_member(p_group_id, me);
  else
    update public.group_invitations
       set status = 'declined', responded_at = now()
     where group_id = p_group_id and member_id = me;
  end if;
end;
$$;
revoke all on function public.respond_group_invitation(bigint, boolean) from public, anon, authenticated;
grant execute on function public.respond_group_invitation(bigint, boolean) to authenticated;


-- ============ Asking to join ============

-- Returns 'joined' (an open group, or you'd already been invited) or
-- 'requested'. A declined request can be made again after seven days — long
-- enough that a "no" means something, short enough that a society that
-- declined by mistake isn't stuck.
create or replace function public.request_to_join_group(p_group_id bigint)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := (select auth.uid());
  g public.groups%rowtype;
  v_row public.group_invitations%rowtype;
begin
  if me is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  select * into g from public.groups where id = p_group_id;
  if not found or g.hidden_at is not null or g.privacy = 'invite' then
    raise exception 'That group is invite only.';
  end if;
  if public.is_group_member(p_group_id, me) then
    return 'joined';
  end if;
  if public.group_blocked_by_admins(p_group_id, me) then
    raise exception 'You can''t join this group.';
  end if;

  select * into v_row from public.group_invitations where group_id = p_group_id and member_id = me;

  if g.privacy = 'open' or (found and v_row.direction = 'invite' and v_row.status = 'pending') then
    perform public.group_add_member(p_group_id, me);
    return 'joined';
  end if;

  if g.member_count >= public.group_capacity(g.kind) then
    raise exception 'This group is full.';
  end if;

  if found then
    if v_row.status = 'pending' then
      return 'requested';
    end if;
    if v_row.status = 'declined' and v_row.direction = 'request'
       and coalesce(v_row.responded_at, v_row.created_at) > now() - interval '7 days' then
      raise exception 'Your request was turned down recently — you can ask again in a few days.';
    end if;
    update public.group_invitations
       set direction = 'request', invited_by = null, status = 'pending', created_at = now(), responded_at = null
     where id = v_row.id;
  else
    insert into public.group_invitations (group_id, member_id, direction)
    values (p_group_id, me, 'request');
  end if;
  return 'requested';
end;
$$;
revoke all on function public.request_to_join_group(bigint) from public, anon, authenticated;
grant execute on function public.request_to_join_group(bigint) to authenticated;

create or replace function public.withdraw_group_request(p_group_id bigint)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.group_invitations
   where group_id = p_group_id
     and member_id = (select auth.uid())
     and direction = 'request'
     and status = 'pending';
$$;
revoke all on function public.withdraw_group_request(bigint) from public, anon, authenticated;
grant execute on function public.withdraw_group_request(bigint) to authenticated;

create or replace function public.review_group_request(p_group_id bigint, p_member_id uuid, p_approve boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(public.group_role(p_group_id, (select auth.uid())), '') not in ('owner', 'admin') then
    raise exception 'Only whoever runs the group can answer requests.';
  end if;
  if not exists (
    select 1 from public.group_invitations
    where group_id = p_group_id and member_id = p_member_id and direction = 'request' and status = 'pending'
  ) then
    raise exception 'That request has already been answered or withdrawn.';
  end if;

  if coalesce(p_approve, false) then
    perform public.group_add_member(p_group_id, p_member_id);
  else
    update public.group_invitations
       set status = 'declined', responded_at = now()
     where group_id = p_group_id and member_id = p_member_id;
  end if;
end;
$$;
revoke all on function public.review_group_request(bigint, uuid, boolean) from public, anon, authenticated;
grant execute on function public.review_group_request(bigint, uuid, boolean) to authenticated;


-- ============ Invite links ============

-- The code for this group, made on first ask. Only for those who may invite.
create or replace function public.group_invite_code(p_group_id bigint)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := public.group_role(p_group_id, (select auth.uid()));
  g public.groups%rowtype;
  v_code text;
begin
  select * into g from public.groups where id = p_group_id;
  if not found or g.hidden_at is not null then
    raise exception 'That group no longer exists.';
  end if;
  if v_role is null or (v_role = 'member' and not g.members_can_invite) then
    raise exception 'Only whoever runs this group can share its invite link.';
  end if;

  v_code := g.invite_code;
  while v_code is null loop
    v_code := substr(md5(gen_random_uuid()::text), 1, 8);
    begin
      update public.groups set invite_code = v_code where id = p_group_id and invite_code is null;
      select invite_code into v_code from public.groups where id = p_group_id;
    exception when unique_violation then
      v_code := null;
    end;
  end loop;
  return v_code;
end;
$$;
revoke all on function public.group_invite_code(bigint) from public, anon, authenticated;
grant execute on function public.group_invite_code(bigint) to authenticated;

-- A new code; the old link stops working. Owner and admins.
create or replace function public.reset_group_invite_code(p_group_id bigint)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
begin
  if coalesce(public.group_role(p_group_id, (select auth.uid())), '') not in ('owner', 'admin') then
    raise exception 'Only whoever runs the group can reset its link.';
  end if;
  update public.groups set invite_code = null where id = p_group_id;
  v_code := public.group_invite_code(p_group_id);
  return v_code;
end;
$$;
revoke all on function public.reset_group_invite_code(bigint) from public, anon, authenticated;
grant execute on function public.reset_group_invite_code(bigint) to authenticated;

-- What the link's page shows before anyone signs in: the group's name, kind,
-- size, home club and who runs it (first name only). Callable by anon for
-- the website's /join/g/<code> page.
create or replace function public.group_invite_preview(p_code text)
returns table (group_id bigint, name text, kind text, about text, member_count integer, club_name text, owner_first_name text)
language sql
stable
security definer
set search_path = public
as $$
  select g.id, g.name, g.kind, g.about, g.member_count, c.name, p.first_name
    from public.groups g
    left join public.clubs c on c.id = g.club_id
    left join public.group_members o on o.group_id = g.id and o.role = 'owner'
    left join public.profiles p on p.id = o.member_id
   where g.invite_code = lower(btrim(p_code))
     and g.hidden_at is null;
$$;
revoke all on function public.group_invite_preview(text) from public, anon, authenticated;
grant execute on function public.group_invite_preview(text) to anon, authenticated;

create or replace function public.join_group_by_code(p_code text)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := (select auth.uid());
  v_group bigint;
begin
  if me is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  select id into v_group from public.groups
   where invite_code = lower(btrim(coalesce(p_code, ''))) and hidden_at is null;
  if v_group is null then
    raise exception 'That invite link isn''t valid any more — ask for a new one.';
  end if;
  perform public.group_add_member(v_group, me);
  return v_group;
end;
$$;
revoke all on function public.join_group_by_code(text) from public, anon, authenticated;
grant execute on function public.join_group_by_code(text) to authenticated;


-- ============ Leaving, removing, roles ============

-- The owner can't simply leave a group other people are in — someone has to
-- run it. They hand it over first (set_group_role … 'owner') or delete it.
-- An owner alone in their group leaves by deleting it.
create or replace function public.leave_group(p_group_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := (select auth.uid());
  v_role text := public.group_role(p_group_id, (select auth.uid()));
begin
  if v_role is null then
    return;
  end if;
  if v_role = 'owner' then
    if (select member_count from public.groups where id = p_group_id) > 1 then
      raise exception 'Hand the group to someone else first, or delete it.';
    end if;
    delete from public.groups where id = p_group_id;
    return;
  end if;
  delete from public.group_members where group_id = p_group_id and member_id = me;
end;
$$;
revoke all on function public.leave_group(bigint) from public, anon, authenticated;
grant execute on function public.leave_group(bigint) to authenticated;

-- The owner may remove anyone else; an admin may remove ordinary members.
-- Their invitation row is marked declined, so they can't walk back in on an
-- old invitation (an invite link still works unless it's reset).
create or replace function public.remove_group_member(p_group_id bigint, p_member_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := (select auth.uid());
  v_mine text := public.group_role(p_group_id, (select auth.uid()));
  v_theirs text := public.group_role(p_group_id, p_member_id);
begin
  if v_theirs is null then
    return;
  end if;
  if p_member_id = me then
    raise exception 'To leave the group, use Leave.';
  end if;
  if not (v_mine = 'owner' or (v_mine = 'admin' and v_theirs = 'member')) then
    raise exception 'You can''t remove that member.';
  end if;
  delete from public.group_members where group_id = p_group_id and member_id = p_member_id;
  update public.group_invitations
     set status = 'declined', responded_at = now()
   where group_id = p_group_id and member_id = p_member_id;
end;
$$;
revoke all on function public.remove_group_member(bigint, uuid) from public, anon, authenticated;
grant execute on function public.remove_group_member(bigint, uuid) to authenticated;

-- The owner only. 'admin' or 'member' for anyone else; 'owner' hands the
-- group over, and the old owner becomes an admin.
create or replace function public.set_group_role(p_group_id bigint, p_member_id uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := (select auth.uid());
begin
  if coalesce(public.group_role(p_group_id, me), '') <> 'owner' then
    raise exception 'Only the group''s owner can change roles.';
  end if;
  if p_member_id = me then
    raise exception 'Hand the group to someone else to change your own role.';
  end if;
  if not public.is_group_member(p_group_id, p_member_id) then
    raise exception 'They''re not in this group.';
  end if;
  if p_role not in ('owner', 'admin', 'member') then
    raise exception 'Unknown role.';
  end if;

  if p_role = 'owner' then
    update public.group_members set role = 'admin' where group_id = p_group_id and member_id = me;
  end if;
  update public.group_members set role = p_role where group_id = p_group_id and member_id = p_member_id;
end;
$$;
revoke all on function public.set_group_role(bigint, uuid, text) from public, anon, authenticated;
grant execute on function public.set_group_role(bigint, uuid, text) to authenticated;

-- Mute or unmute a group's notifications, for yourself.
create or replace function public.set_group_muted(p_group_id bigint, p_muted boolean)
returns void
language sql
security definer
set search_path = public
as $$
  update public.group_members
     set muted = coalesce(p_muted, false)
   where group_id = p_group_id and member_id = (select auth.uid());
$$;
revoke all on function public.set_group_muted(bigint, boolean) from public, anon, authenticated;
grant execute on function public.set_group_muted(bigint, boolean) to authenticated;
