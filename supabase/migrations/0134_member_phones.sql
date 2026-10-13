-- Verified mobile numbers (Oct 2026). Design: claude/mobile-numbers.md
--
-- 1. A member adds a mobile and proves it with a text code (Supabase Auth's
--    phone change). Once Auth marks it confirmed, a trigger copies it to
--    member_phones — readable by that member only. Nothing else writes it.
-- 2. With a verified mobile they can sign in with a text code instead of a
--    password (Auth, no database change).
-- 3. Sharing is per group, the member's own choice (member_phone_shares).
--    Shared with a group: the people who run it (owner and admins — in a
--    society, the captain and secretary) can see it. If the member runs the
--    group themselves, its members can see it too, so they can reach them.
--    group_contacts() is the only way anyone else reads a number.
-- 4. remove_my_phone() takes the number off the account entirely (Auth too)
--    and ends every share.
--
-- Rollback:
--   drop function if exists public.group_contacts(bigint), public.remove_my_phone(),
--     public.remove_member_phone(uuid), public.sync_member_phone();
--   drop trigger if exists sync_member_phone on auth.users;
--   drop table if exists public.member_phone_shares, public.member_phones;


-- ============ The number ============

create table if not exists public.member_phones (
  member_id uuid primary key references public.profiles (id) on delete cascade,
  phone text not null check (phone ~ '^\+[1-9][0-9]{6,14}$'),
  verified_at timestamptz not null,
  updated_at timestamptz not null default now()
);

alter table public.member_phones enable row level security;

drop policy if exists "own mobile" on public.member_phones;
create policy "own mobile" on public.member_phones
  for select to authenticated using (member_id = (select auth.uid()));

revoke all on public.member_phones from anon, authenticated;
grant select on public.member_phones to authenticated;


-- ============ Who it is shared with ============

create table if not exists public.member_phone_shares (
  member_id uuid not null references public.profiles (id) on delete cascade,
  group_id bigint not null references public.groups (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (member_id, group_id)
);

create index if not exists member_phone_shares_group on public.member_phone_shares (group_id);

alter table public.member_phone_shares enable row level security;

drop policy if exists "own shares" on public.member_phone_shares;
create policy "own shares" on public.member_phone_shares
  for select to authenticated using (member_id = (select auth.uid()));
drop policy if exists "share with my groups" on public.member_phone_shares;
create policy "share with my groups" on public.member_phone_shares
  for insert to authenticated with check (
    member_id = (select auth.uid())
    and exists (select 1 from public.group_members m where m.group_id = member_phone_shares.group_id and m.member_id = (select auth.uid()))
  );
drop policy if exists "stop sharing" on public.member_phone_shares;
create policy "stop sharing" on public.member_phone_shares
  for delete to authenticated using (member_id = (select auth.uid()));

revoke all on public.member_phone_shares from anon, authenticated;
grant select, insert, delete on public.member_phone_shares to authenticated;


-- ============ Kept in step with Auth ============

-- After Auth changes a member's phone: copy it once confirmed, drop it once
-- gone. Never blocks Auth — a failure here leaves the number unshared, which
-- is the safe way round.
create or replace function public.sync_member_phone()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.phone is not null and btrim(new.phone) <> '' and new.phone_confirmed_at is not null then
    if exists (select 1 from public.profiles where id = new.id) then
      insert into public.member_phones (member_id, phone, verified_at)
      values (new.id, '+' || ltrim(btrim(new.phone), '+'), new.phone_confirmed_at)
      on conflict (member_id) do update
        set phone = excluded.phone, verified_at = excluded.verified_at, updated_at = now();
    end if;
  else
    delete from public.member_phones where member_id = new.id;
  end if;
  return null;
exception when others then
  return null;
end;
$$;
revoke all on function public.sync_member_phone() from public, anon, authenticated;

drop trigger if exists sync_member_phone on auth.users;
create trigger sync_member_phone
  after update of phone, phone_confirmed_at on auth.users
  for each row execute function public.sync_member_phone();

-- Any number already verified in Auth.
insert into public.member_phones (member_id, phone, verified_at)
select u.id, '+' || ltrim(btrim(u.phone), '+'), u.phone_confirmed_at
  from auth.users u
  join public.profiles p on p.id = u.id
 where u.phone is not null and btrim(u.phone) <> '' and u.phone_confirmed_at is not null
   and ('+' || ltrim(btrim(u.phone), '+')) ~ '^\+[1-9][0-9]{6,14}$'
on conflict (member_id) do nothing;


-- ============ Taking it off ============

-- The number off the account, Auth included, and every share ended. The
-- server uses this when an account is deleted.
create or replace function public.remove_member_phone(p_member uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update auth.users set phone = null, phone_confirmed_at = null where id = p_member;
  delete from public.member_phones where member_id = p_member;
  delete from public.member_phone_shares where member_id = p_member;
end;
$$;
revoke all on function public.remove_member_phone(uuid) from public, anon, authenticated;
grant execute on function public.remove_member_phone(uuid) to service_role;

create or replace function public.remove_my_phone()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
begin
  if v_me is null then
    raise exception 'Sign in first.';
  end if;
  perform public.remove_member_phone(v_me);
end;
$$;
revoke all on function public.remove_my_phone() from public, anon, authenticated;
grant execute on function public.remove_my_phone() to authenticated;


-- ============ Reading a shared number ============

-- For a group you're in: the people who run it see every member who shared
-- with it; everyone else sees the people who run it, if they shared.
create or replace function public.group_contacts(p_group_id bigint)
returns table (
  member_id uuid,
  first_name text,
  last_name text,
  role text,
  office text,
  phone text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_role text := public.group_role(p_group_id, v_me);
begin
  if v_role is null then
    raise exception 'Only the group''s members can see its contacts.';
  end if;

  return query
    select m.member_id, p.first_name, p.last_name, m.role, m.office, ph.phone
      from public.group_members m
      join public.member_phone_shares s on s.group_id = m.group_id and s.member_id = m.member_id
      join public.member_phones ph on ph.member_id = m.member_id
      join public.profiles p on p.id = m.member_id
      join public.groups g on g.id = m.group_id and g.hidden_at is null
     where m.group_id = p_group_id
       and (v_role in ('owner', 'admin') or m.role in ('owner', 'admin'))
     order by case m.role when 'owner' then 0 when 'admin' then 1 else 2 end, p.first_name, p.last_name;
end;
$$;
revoke all on function public.group_contacts(bigint) from public, anon, authenticated;
grant execute on function public.group_contacts(bigint) to authenticated;
