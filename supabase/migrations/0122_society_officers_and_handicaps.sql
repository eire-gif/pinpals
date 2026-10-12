-- Society officers and handicaps (Oct 2026). Design: claude/society-handicaps.md
--
-- 1. OFFICERS. A society is run by the member who created it (the owner),
--    who appoints a CAPTAIN and a SECRETARY (group_members.office). Each is
--    one person at a time: appointing a new captain stands the old one down.
--    An officer runs the society with the owner (role 'admin'); in a
--    society, officers are the only admins — set_group_role refuses a plain
--    'admin' there.
--
-- 2. WHO BRINGS PEOPLE IN. In a society only the owner, captain and
--    secretary invite, share or reset the link, and approve requests
--    (members_can_invite is always false for a society; a check holds it).
--    Whoever runs a group (owner or admin) can now invite ANY member, not
--    only their connections: that is what "Find PinPals" on the invite
--    screen is for. Ordinary members of a crew or trip still invite their
--    own connections only.
--
-- 3. THE HANDICAP INDICATOR. Worked out from a member's last 20 eligible
--    scorecards (0110), the World Handicap System way:
--      - eligible: 18 holes, course rating and slope on the card, 14 or
--        more holes scored. 9-hole cards don't count (yet).
--      - each hole is capped at net double bogey (par + 2 + strokes
--        received, from the index on the card, else the member's own); with
--        no index anywhere, par + 5. A hole with no score counts as net
--        double bogey.
--      - differential = (113 / slope) × (adjusted gross − course rating),
--        to one decimal. No playing-conditions adjustment.
--      - indicator = the average of the best N (3 cards: best 1 − 2.0 …
--        20 cards: best 8), to one decimal, at most 54.0. Fewer than 3: none.
--    It never replaces the handicap a member enters themselves; it is shown
--    beside it. The member sees their own (and which cards count); a
--    society's owner, captain and secretary see their members'.
--
-- 4. SOCIETY HANDICAPS. The secretary (or captain, or owner) can set the
--    index the society plays a member off (group_members.society_index).
--    Society rounds pre-fill it. society_handicaps() gives an officer each
--    member's own handicap, the indicator and the society's figure in one
--    list.
--
-- Rollback:
--   drop function if exists public.society_handicaps(bigint);
--   drop function if exists public.set_society_handicap(bigint, uuid, numeric);
--   drop function if exists public.my_handicap_indicator();
--   drop function if exists public.my_handicap_differentials();
--   drop function if exists public.handicap_indicator_of(uuid);
--   drop function if exists public.handicap_differentials_of(uuid);
--   drop function if exists public.set_group_office(bigint, uuid, text);
--   alter table public.groups drop constraint if exists groups_society_invites_check;
--   alter table public.group_members drop column if exists office,
--     drop column if exists society_index, drop column if exists society_index_set_by,
--     drop column if exists society_index_set_at;
--   …then re-run the 0120 bodies of create_group, update_group,
--   invite_to_group and set_group_role.


-- ============ Columns ============

alter table public.group_members
  add column if not exists office text check (office is null or office in ('captain', 'secretary')),
  add column if not exists society_index numeric(3, 1) check (society_index is null or society_index between -10 and 54),
  add column if not exists society_index_set_by uuid references public.profiles (id) on delete set null,
  add column if not exists society_index_set_at timestamptz;

-- One captain and one secretary per society.
create unique index if not exists group_members_one_per_office
  on public.group_members (group_id, office)
  where office is not null;

comment on column public.group_members.office is 'Societies only: captain or secretary, appointed by the owner. An officer is an admin.';
comment on column public.group_members.society_index is 'The handicap index the society plays this member off, set by an officer. Null: use their own.';

-- In a society, only the officers bring people in.
update public.groups set members_can_invite = false where kind = 'society' and members_can_invite;
alter table public.groups drop constraint if exists groups_society_invites_check;
alter table public.groups add constraint groups_society_invites_check check (kind <> 'society' or not members_can_invite);


-- ============ Creating and editing: societies never let members invite ============

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
  insert into public.groups (kind, name, about, privacy, features, members_can_invite, club_id, starts_on, ends_on, created_by)
  values (
    p_kind,
    v_name,
    v_about,
    case p_kind when 'society' then 'request' else 'invite' end,
    case p_kind
      when 'society' then array['posts', 'events', 'polls', 'tee_times']
      else array['posts', 'events', 'polls', 'chat', 'tee_times']
    end,
    p_kind <> 'society',
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
         -- A society's members never invite: its officers do.
         members_can_invite = case when kind = 'society' then false else coalesce(p_members_can_invite, members_can_invite) end,
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


-- ============ Inviting: whoever runs a group can invite any member ============

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
  v_runs boolean;
  v_id uuid;
  v_row public.group_invitations%rowtype;
  v_done integer := 0;
begin
  select * into g from public.groups where id = p_group_id;
  if not found or g.hidden_at is not null then
    raise exception 'That group no longer exists.';
  end if;
  if v_role is null or (v_role = 'member' and not g.members_can_invite) then
    if g.kind = 'society' then
      raise exception 'Only the society''s captain or secretary can invite people to it.';
    end if;
    raise exception 'Only whoever runs this group can invite people to it.';
  end if;
  if coalesce(array_length(p_member_ids, 1), 0) > 50 then
    raise exception 'Invite up to 50 people at a time.';
  end if;
  v_runs := v_role in ('owner', 'admin');

  for v_id in select distinct x from unnest(coalesce(p_member_ids, '{}'::uuid[])) as t(x) where x is not null loop
    continue when v_id = me
      or public.is_group_member(p_group_id, v_id)
      -- Ordinary members invite their own PinPals; whoever runs the group
      -- can invite anyone they find (Find PinPals). They still have to accept.
      or (not v_runs and not public.are_connected(me, v_id))
      or public.is_blocked(me, v_id)
      or public.group_blocked_by_admins(p_group_id, v_id)
      or not exists (select 1 from public.profiles p where p.id = v_id and p.deleted_at is null);

    select * into v_row from public.group_invitations where group_id = p_group_id and member_id = v_id;

    if found and v_row.direction = 'request' and v_row.status = 'pending' and v_runs then
      -- They asked; someone who can approve is inviting them. That's a yes.
      if public.group_add_member(p_group_id, v_id) then
        v_done := v_done + 1;
      end if;
    elsif found and v_row.direction = 'invite' and v_row.status = 'pending' then
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


-- ============ Roles and offices ============

-- As 0120, plus: in a society there is no plain 'admin' (appoint a captain
-- or secretary instead), and making someone an ordinary member stands them
-- down from any office.
create or replace function public.set_group_role(p_group_id bigint, p_member_id uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := (select auth.uid());
  v_kind text := (select kind from public.groups where id = p_group_id);
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
  if p_role = 'admin' and v_kind = 'society' then
    raise exception 'In a society, make them captain or secretary instead.';
  end if;

  if p_role = 'owner' then
    update public.group_members set role = 'admin' where group_id = p_group_id and member_id = me;
  end if;
  update public.group_members
     set role = p_role,
         office = case when p_role = 'member' then null else office end
   where group_id = p_group_id and member_id = p_member_id;
end;
$$;
revoke all on function public.set_group_role(bigint, uuid, text) from public, anon, authenticated;
grant execute on function public.set_group_role(bigint, uuid, text) to authenticated;

-- The owner appoints a society's captain or secretary (p_office), or stands
-- someone down (p_office null). A new captain replaces the old one, who goes
-- back to being an ordinary member (unless they own the society). The owner
-- can hold an office themselves.
create or replace function public.set_group_office(p_group_id bigint, p_member_id uuid, p_office text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := (select auth.uid());
  v_office text := nullif(btrim(coalesce(p_office, '')), '');
begin
  if coalesce(public.group_role(p_group_id, me), '') <> 'owner' then
    raise exception 'Only the society''s owner can appoint its captain and secretary.';
  end if;
  if (select kind from public.groups where id = p_group_id) is distinct from 'society' then
    raise exception 'Only a society has a captain and a secretary.';
  end if;
  if not public.is_group_member(p_group_id, p_member_id) then
    raise exception 'They''re not in this society.';
  end if;
  if v_office is not null and v_office not in ('captain', 'secretary') then
    raise exception 'Unknown office.';
  end if;

  if v_office is null then
    update public.group_members
       set office = null,
           role = case when role = 'admin' then 'member' else role end
     where group_id = p_group_id and member_id = p_member_id;
    return;
  end if;

  -- Whoever held it stands down.
  update public.group_members
     set office = null,
         role = case when role = 'admin' then 'member' else role end
   where group_id = p_group_id and office = v_office and member_id <> p_member_id;

  update public.group_members
     set office = v_office,
         role = case when role = 'owner' then 'owner' else 'admin' end
   where group_id = p_group_id and member_id = p_member_id;
end;
$$;
revoke all on function public.set_group_office(bigint, uuid, text) from public, anon, authenticated;
grant execute on function public.set_group_office(bigint, uuid, text) to authenticated;


-- ============ The handicap indicator ============

-- A member's last 20 eligible cards, newest first, each with its adjusted
-- gross score and differential, and whether it is one of the best N that
-- make the indicator. Internal: no grants (the wrappers below decide who may
-- see whose).
create or replace function public.handicap_differentials_of(p_member uuid)
returns table (
  scorecard_id bigint,
  played_on date,
  course_name text,
  tee_name text,
  adjusted_gross integer,
  differential numeric,
  counts boolean
)
language sql
stable
security definer
set search_path = public
as $$
  with recent as (
    select s.id, s.played_on, s.course_name, s.tee_name, s.course_rating, s.slope,
           coalesce(s.handicap_index, p.handicap) as idx,
           coalesce(s.par_total, (select sum(h.par) from public.scorecard_holes h where h.scorecard_id = s.id))::int as par
      from public.scorecards s
      join public.profiles p on p.id = s.member_id
     where s.member_id = p_member
       and s.holes = 18
       and s.course_rating is not null
       and s.slope is not null
       and (select count(*) from public.scorecard_holes h where h.scorecard_id = s.id) = 18
       and (select count(*) from public.scorecard_holes h where h.scorecard_id = s.id and h.strokes is not null) >= 14
     order by s.played_on desc, s.id desc
     limit 20
  ),
  -- Course handicap for the card's tees (WHS), from the index played off.
  ch as (
    select r.*,
           case when r.idx is null then null
                else round(r.idx * r.slope / 113.0 + (r.course_rating - r.par))::int end as course_hcp
      from recent r
  ),
  holes as (
    select c.id,
           h.strokes,
           case
             when c.course_hcp is null then h.par + 5
             else h.par + 2
                  + floor(c.course_hcp / 18.0)::int
                  + case when coalesce(h.stroke_index, h.hole) <= ((c.course_hcp % 18) + 18) % 18 then 1 else 0 end
           end as cap
      from ch c
      join public.scorecard_holes h on h.scorecard_id = c.id
  ),
  scored as (
    select c.id, c.played_on, c.course_name, c.tee_name,
           sum(least(coalesce(h.strokes, h.cap), h.cap))::int as ags,
           c.course_rating, c.slope
      from ch c
      join holes h on h.id = c.id
     group by c.id, c.played_on, c.course_name, c.tee_name, c.course_rating, c.slope
  ),
  diffs as (
    select s.*,
           round((113.0 / s.slope) * (s.ags - s.course_rating), 1) as diff,
           count(*) over () as n,
           row_number() over (order by round((113.0 / s.slope) * (s.ags - s.course_rating), 1), s.played_on desc, s.id desc) as rank
      from scored s
  )
  select d.id, d.played_on, d.course_name, d.tee_name, d.ags, d.diff,
         d.n >= 3 and d.rank <= case
           when d.n <= 5 then 1
           when d.n <= 8 then 2
           when d.n <= 11 then 3
           when d.n <= 14 then 4
           when d.n <= 16 then 5
           when d.n <= 18 then 6
           when d.n = 19 then 7
           else 8
         end
    from diffs d
   order by d.played_on desc, d.id desc;
$$;
revoke all on function public.handicap_differentials_of(uuid) from public, anon, authenticated;

-- The indicator itself: null with fewer than 3 eligible cards.
create or replace function public.handicap_indicator_of(p_member uuid)
returns table (indicator numeric, rounds integer, counting integer)
language sql
stable
security definer
set search_path = public
as $$
  with d as (select * from public.handicap_differentials_of(p_member)),
  agg as (
    select count(*)::int as n,
           count(*) filter (where counts)::int as k,
           avg(differential) filter (where counts) as best
      from d
  )
  select case when a.n < 3 then null
              else least(54.0, round(a.best + case a.n when 3 then -2.0 when 4 then -1.0 when 6 then -1.0 else 0 end, 1))
         end,
         a.n,
         a.k
    from agg a;
$$;
revoke all on function public.handicap_indicator_of(uuid) from public, anon, authenticated;

-- Your own, for the profile.
create or replace function public.my_handicap_indicator()
returns table (indicator numeric, rounds integer, counting integer)
language sql
stable
security definer
set search_path = public
as $$
  select * from public.handicap_indicator_of((select auth.uid())) where (select auth.uid()) is not null;
$$;
revoke all on function public.my_handicap_indicator() from public, anon, authenticated;
grant execute on function public.my_handicap_indicator() to authenticated;

create or replace function public.my_handicap_differentials()
returns table (scorecard_id bigint, played_on date, course_name text, tee_name text, adjusted_gross integer, differential numeric, counts boolean)
language sql
stable
security definer
set search_path = public
as $$
  select * from public.handicap_differentials_of((select auth.uid())) where (select auth.uid()) is not null;
$$;
revoke all on function public.my_handicap_differentials() from public, anon, authenticated;
grant execute on function public.my_handicap_differentials() to authenticated;


-- ============ Society handicaps ============

-- The secretary's list: for each member of the society, the handicap they
-- set themselves, the indicator from their scorecards, and the index the
-- society plays them off. Owner, captain and secretary only. Joining a
-- society shares your handicap with the people who run it; the app says so
-- on the society's page.
create or replace function public.society_handicaps(p_group_id bigint)
returns table (
  member_id uuid,
  own_index numeric,
  indicator numeric,
  rounds integer,
  society_index numeric,
  society_index_set_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if (select kind from public.groups where id = p_group_id and hidden_at is null) is distinct from 'society' then
    raise exception 'Only a society keeps handicaps.';
  end if;
  if coalesce(public.group_role(p_group_id, (select auth.uid())), '') not in ('owner', 'admin') then
    raise exception 'Only the society''s captain and secretary can see its handicaps.';
  end if;

  return query
    select m.member_id, p.handicap, i.indicator, i.rounds, m.society_index, m.society_index_set_at
      from public.group_members m
      join public.profiles p on p.id = m.member_id
      cross join lateral public.handicap_indicator_of(m.member_id) i
     where m.group_id = p_group_id;
end;
$$;
revoke all on function public.society_handicaps(bigint) from public, anon, authenticated;
grant execute on function public.society_handicaps(bigint) to authenticated;

-- Sets (or, with null, clears) the index the society plays a member off.
create or replace function public.set_society_handicap(p_group_id bigint, p_member_id uuid, p_index numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := (select auth.uid());
begin
  if (select kind from public.groups where id = p_group_id and hidden_at is null) is distinct from 'society' then
    raise exception 'Only a society keeps handicaps.';
  end if;
  if coalesce(public.group_role(p_group_id, me), '') not in ('owner', 'admin') then
    raise exception 'Only the society''s captain and secretary can set handicaps.';
  end if;
  if not public.is_group_member(p_group_id, p_member_id) then
    raise exception 'They''re not in this society.';
  end if;
  if p_index is not null and (p_index < -10 or p_index > 54) then
    raise exception 'A handicap index is between +10 and 54.';
  end if;

  update public.group_members
     set society_index = round(p_index, 1),
         society_index_set_by = case when p_index is null then null else me end,
         society_index_set_at = case when p_index is null then null else now() end
   where group_id = p_group_id and member_id = p_member_id;
end;
$$;
revoke all on function public.set_society_handicap(bigint, uuid, numeric) from public, anon, authenticated;
grant execute on function public.set_society_handicap(bigint, uuid, numeric) to authenticated;
