-- Invite your group to a tee time, and take a place in one tap (22 Oct 2026).
-- Design: claude/tee-time-group-invites.md.
--
-- WHAT CHANGES
--
--   - When posting a tee time the host can pick one or more of their groups
--     (Golf Buddies, a trip, a society). Every member of those groups gets an
--     invitation (0132's table) marked `ready`: the host has said yes to them
--     in advance.
--   - A ready invitation is taken with one tap — take_tee_time_place() — and
--     the place is confirmed straight away. First come, first served: when the
--     spaces are gone the round is full and the rest are told so.
--   - "Can't make it" (pass_tee_time_place) just puts the invitation aside so
--     the alert stops asking.
--   - Everything else is unchanged. Someone invited the 0132 way (not ready)
--     still asks and the host still offers.
--
-- Rollback:
--   drop function if exists public.invite_group_to_tee_time(bigint, bigint),
--     public.take_tee_time_place(bigint), public.pass_tee_time_place(bigint);
--   alter table public.tee_time_invitations
--     drop column if exists ready, drop column if exists group_id, drop column if exists passed_at;
--   restore 0132's via check ('member', 'link').


-- ============ Table ============

alter table public.tee_time_invitations
  add column if not exists group_id bigint references public.groups (id) on delete set null,
  -- The host invited them, so no second yes is needed: taking a place confirms it.
  add column if not exists ready boolean not null default false,
  -- The member said they can't make it. Kept rather than deleted so a second
  -- group invite to the same round doesn't ask them again.
  add column if not exists passed_at timestamptz;

alter table public.tee_time_invitations drop constraint if exists tee_time_invitations_via_check;
alter table public.tee_time_invitations
  add constraint tee_time_invitations_via_check check (via in ('member', 'link', 'group'));

create index if not exists tee_time_invitations_group_idx on public.tee_time_invitations (group_id) where group_id is not null;


-- ============ Inviting a group ============

-- Only the host, and only a group they are in. Returns the members newly
-- invited — the ones to tell. Anyone already in the round, already invited,
-- blocked, under 18, or the host is skipped.
create or replace function public.invite_group_to_tee_time(p_invite_id bigint, p_group_id bigint)
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
  if not found or t.member_id is distinct from me then
    raise exception 'Only the host can invite a group to this round.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.group_members where group_id = p_group_id and member_id = me) then
    raise exception 'You can only invite a group you are in.' using errcode = '42501';
  end if;
  if t.status <> 'open' or t.spaces_available < 1 then raise exception 'This round is full.'; end if;
  if t.play_date < (now() at time zone 'Europe/Dublin')::date then raise exception 'This round has been played.'; end if;

  for v_member in
    select gm.member_id from public.group_members gm where gm.group_id = p_group_id and gm.member_id <> me
  loop
    continue when public.is_blocked(me, v_member);
    -- Tee times are adults only (0159). Juniors stay in the group; they just
    -- aren't asked.
    continue when public.is_minor(v_member);
    continue when exists (select 1 from public.tee_time_interests where invite_id = p_invite_id and member_id = v_member);
    insert into public.tee_time_invitations (invite_id, member_id, invited_by, via, group_id, ready)
    values (p_invite_id, v_member, me, 'group', p_group_id, true)
    on conflict (invite_id, member_id) do update
      -- Asked before without the host's yes (0132): the host's group invite
      -- is the yes. Someone who already passed is left alone.
      set ready = true, group_id = excluded.group_id
      where public.tee_time_invitations.ready = false and public.tee_time_invitations.passed_at is null;
    if found then return next v_member; end if;
  end loop;
end;
$$;
revoke all on function public.invite_group_to_tee_time(bigint, bigint) from public, anon, authenticated;
grant execute on function public.invite_group_to_tee_time(bigint, bigint) to authenticated;


-- ============ Taking a place ============

-- One tap, place confirmed. Same row lock as respond_to_tee_time_interest()
-- (0077), so two buddies tapping at once can never both get the last space.
create or replace function public.take_tee_time_place(p_invite_id bigint)
returns table (
  interest_id      bigint,
  host_id          uuid,
  invite_id        bigint,
  club_name        text,
  play_date        date,
  spaces_remaining smallint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := (select auth.uid());
  v_inv public.tee_time_invitations%rowtype;
  t public.tee_time_invites%rowtype;
  v_interest public.tee_time_interests%rowtype;
  v_left smallint;
  v_id bigint;
begin
  if me is null then raise exception 'You need to be signed in to take a place.'; end if;

  select * into v_inv from public.tee_time_invitations
   where tee_time_invitations.invite_id = p_invite_id and member_id = me;
  if not found or not v_inv.ready then
    raise exception 'This place needs the host''s OK — ask to join instead.' using errcode = '42501';
  end if;

  select * into t from public.tee_time_invites where id = p_invite_id for update;
  if not found then raise exception 'That tee time no longer exists.'; end if;
  if public.is_blocked(t.member_id, me) then raise exception 'This round isn''t open to you.' using errcode = '42501'; end if;

  select * into v_interest from public.tee_time_interests
   where tee_time_interests.invite_id = p_invite_id and member_id = me;

  -- Already in: say so, change nothing. A double tap lands here.
  if found and v_interest.status = 'confirmed' then
    return query select v_interest.id, t.member_id, t.id, t.club_name, t.play_date, t.spaces_available;
    return;
  end if;
  -- Offered a place already (space already held for them): just confirm.
  if found and v_interest.status = 'accepted' then
    update public.tee_time_interests set status = 'confirmed', updated_at = now() where id = v_interest.id;
    update public.tee_time_invitations set passed_at = null where tee_time_invitations.invite_id = p_invite_id and member_id = me;
    return query select v_interest.id, t.member_id, t.id, t.club_name, t.play_date, t.spaces_available;
    return;
  end if;
  -- The host turned them down for this round: that answer stands.
  if found and v_interest.status = 'declined' and v_interest.withdrawn_at is null then
    raise exception 'The host has closed this round to you.' using errcode = '42501';
  end if;

  if t.status = 'cancelled' then raise exception 'This round was cancelled.'; end if;
  if t.play_date < (now() at time zone 'Europe/Dublin')::date then raise exception 'This round has been played.'; end if;
  if t.status <> 'open' or t.spaces_available < 1 then
    raise exception 'Sorry — the places have all been taken.';
  end if;

  update public.tee_time_invites
     set spaces_available = spaces_available - 1,
         status = case when spaces_available - 1 = 0 then 'full' else status end
   where id = p_invite_id
  returning spaces_available into v_left;

  if v_interest.id is not null then
    -- Asked earlier (pending) or dropped out and coming back.
    update public.tee_time_interests
       set status = 'confirmed', withdrawn_at = null, updated_at = now()
     where id = v_interest.id;
    v_id := v_interest.id;
  else
    insert into public.tee_time_interests (invite_id, member_id, status)
    values (p_invite_id, me, 'confirmed')
    returning id into v_id;
  end if;

  update public.tee_time_invitations set passed_at = null
   where tee_time_invitations.invite_id = p_invite_id and member_id = me;

  return query select v_id, t.member_id, t.id, t.club_name, t.play_date, v_left;
end;
$$;
revoke all on function public.take_tee_time_place(bigint) from public, anon, authenticated;
grant execute on function public.take_tee_time_place(bigint) to authenticated;


-- "Can't make it". Nothing moves and nobody is told; the alert stops asking.
create or replace function public.pass_tee_time_place(p_invite_id bigint)
returns boolean
language sql
security definer
set search_path = public
as $$
  update public.tee_time_invitations
     set passed_at = now()
   where invite_id = p_invite_id and member_id = (select auth.uid()) and passed_at is null
  returning true;
$$;
revoke all on function public.pass_tee_time_place(bigint) from public, anon, authenticated;
grant execute on function public.pass_tee_time_place(bigint) to authenticated;
