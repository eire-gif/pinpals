-- 0170 — Invite a society's members by email, from a spreadsheet (Oct 2026)
--
-- A society moving onto PinPals already has its member list — names and
-- emails in a spreadsheet. The secretary uploads it (society console →
-- Members → Import from spreadsheet) and every address gets an email. When
-- that person signs in to PinPals with that email, they are in the society
-- with no further step.
--
-- How someone ends up in the society:
--
--   * Already on PinPals with that (confirmed) email → added at import, and
--     emailed "you've been added". They can leave like any member.
--   * Not on PinPals yet → a pending invite. They join the moment their
--     account's email is confirmed (trigger on auth.users below), whether
--     they signed up from the email's button, the website or the app.
--   * Signed up with a different email → the email's button carries a
--     one-off token; opening it signed in (or signing in after opening it)
--     claims the invite for that account (claim_group_email_invite).
--
-- Joining always goes through group_add_member(), so the existing rules
-- hold: capacity, blocks against the committee, and 0159's junior rules
-- (a refusal is kept on the invite as `failure`, shown to the committee).
--
-- Only the society's owner and admins (captain, secretary: society_can
-- 'people') can import, see or cancel these. Tokens are never readable by
-- the client; only the functions that send the email hand them out.
--
-- The auth.users trigger can never break a sign-up: every claim runs in its
-- own exception block.
--
-- Rollback:
--   drop trigger if exists on_auth_user_email_invites on auth.users;
--   drop function if exists public.on_auth_user_email_invites();
--   drop function if exists public.claim_group_email_invites_for(uuid, text);
--   drop function if exists public.import_group_email_invites(bigint, jsonb);
--   drop function if exists public.resend_group_email_invites(bigint, bigint[]);
--   drop function if exists public.cancel_group_email_invite(bigint, bigint);
--   drop function if exists public.group_email_invite_preview(text);
--   drop function if exists public.claim_group_email_invite(text);
--   drop table if exists public.group_email_invites;

create table if not exists public.group_email_invites (
  id                bigint generated always as identity primary key,
  group_id          bigint not null references public.groups(id) on delete cascade,
  email             text not null check (email = lower(btrim(email)) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and length(email) <= 254),
  first_name        text check (first_name is null or length(first_name) <= 60),
  last_name         text check (last_name is null or length(last_name) <= 60),
  token             text not null unique default replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
  status            text not null default 'pending' check (status in ('pending', 'joined', 'cancelled')),
  failure           text,
  invited_by        uuid references public.profiles(id) on delete set null,
  created_at        timestamptz not null default now(),
  emailed_at        timestamptz,
  email_count       integer not null default 0,
  joined_member_id  uuid references public.profiles(id) on delete set null,
  joined_at         timestamptz,
  unique (group_id, email)
);

create index if not exists group_email_invites_pending_email
  on public.group_email_invites (email) where status = 'pending';

alter table public.group_email_invites enable row level security;

revoke all on public.group_email_invites from public, anon, authenticated;
-- Every column but the token.
grant select (id, group_id, email, first_name, last_name, status, failure, invited_by, created_at, emailed_at, email_count, joined_member_id, joined_at)
  on public.group_email_invites to authenticated;

drop policy if exists group_email_invites_committee_read on public.group_email_invites;
create policy group_email_invites_committee_read on public.group_email_invites
  for select to authenticated
  using (public.society_can(group_id, (select auth.uid()), 'people'));

-- ---------------------------------------------------------------------------
-- Join every pending invite for one confirmed email. Internal: called by the
-- auth.users trigger and by the import (for members already on PinPals).
-- ---------------------------------------------------------------------------
create or replace function public.claim_group_email_invites_for(p_user uuid, p_email text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_inv public.group_email_invites%rowtype;
  v_done integer := 0;
begin
  if p_user is null or v_email = '' then
    return 0;
  end if;
  if not exists (select 1 from public.profiles where id = p_user and deleted_at is null) then
    return 0;
  end if;

  for v_inv in
    select * from public.group_email_invites
     where email = v_email and status = 'pending'
     order by id
  loop
    begin
      perform public.group_add_member(v_inv.group_id, p_user);
      update public.group_email_invites
         set status = 'joined', joined_member_id = p_user, joined_at = now(), failure = null
       where id = v_inv.id;
      v_done := v_done + 1;
    exception when others then
      update public.group_email_invites set failure = left(sqlerrm, 200) where id = v_inv.id;
    end;
  end loop;
  return v_done;
end;
$$;
revoke all on function public.claim_group_email_invites_for(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Sign-up / email confirmation → join. Never raises.
-- ---------------------------------------------------------------------------
create or replace function public.on_auth_user_email_invites()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.email_confirmed_at is not null
     and (tg_op = 'INSERT' or old.email_confirmed_at is null or old.email is distinct from new.email) then
    begin
      perform public.claim_group_email_invites_for(new.id, new.email);
    exception when others then
      raise warning '[0170] email invite claim failed for %: %', new.id, sqlerrm;
    end;
  end if;
  return new;
end;
$$;
revoke all on function public.on_auth_user_email_invites() from public, anon, authenticated;

-- Named to run after on_auth_user_created (the profile) and
-- on_auth_user_created_age (0159's junior rules): triggers fire by name.
drop trigger if exists on_auth_user_email_invites on auth.users;
create trigger on_auth_user_email_invites
  after insert or update of email_confirmed_at, email on auth.users
  for each row execute function public.on_auth_user_email_invites();

-- ---------------------------------------------------------------------------
-- The import. p_rows: [{"email": "...", "first_name": "...", "last_name": "..."}]
-- Returns one row per distinct email, with the outcome and — only where an
-- email should go out now — the token for its link.
--   invited          new invite, send the "join" email
--   added            already on PinPals, added now, send "you've been added"
--   already_invited  a pending invite already exists (Resend from the list)
--   already_member   already in the society
--   not_added        on PinPals but couldn't be added (failure says why)
--   invalid          not an email address
-- ---------------------------------------------------------------------------
create or replace function public.import_group_email_invites(p_group_id bigint, p_rows jsonb)
returns table (invite_id bigint, email text, first_name text, outcome text, token text, failure text)
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := (select auth.uid());
  g public.groups%rowtype;
  r jsonb;
  v_email text;
  v_first text;
  v_last text;
  v_user uuid;
  v_inv public.group_email_invites%rowtype;
  v_seen text[] := '{}';
begin
  if me is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  select * into g from public.groups where id = p_group_id;
  if not found or g.hidden_at is not null then
    raise exception 'That society no longer exists.';
  end if;
  if not public.society_can(p_group_id, me, 'people') then
    raise exception 'Only the society''s captain or secretary can invite people to it.' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(p_rows, '[]'::jsonb)) <> 'array' then
    raise exception 'Nothing to import.';
  end if;
  if jsonb_array_length(p_rows) > 500 then
    raise exception 'Import up to 500 people at a time.';
  end if;

  for r in select * from jsonb_array_elements(p_rows) loop
    v_email := lower(btrim(coalesce(r->>'email', '')));
    v_first := nullif(left(btrim(coalesce(r->>'first_name', '')), 60), '');
    v_last := nullif(left(btrim(coalesce(r->>'last_name', '')), 60), '');
    invite_id := null; email := v_email; first_name := v_first; token := null; failure := null;

    if v_email = '' or length(v_email) > 254 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
      outcome := 'invalid';
      return next;
      continue;
    end if;
    continue when v_email = any(v_seen);
    v_seen := v_seen || v_email;

    -- Someone already on PinPals with this email, confirmed.
    select u.id into v_user
      from auth.users u
      join public.profiles p on p.id = u.id and p.deleted_at is null
     where lower(u.email) = v_email and u.email_confirmed_at is not null
     limit 1;

    if v_user is not null and public.is_group_member(p_group_id, v_user) then
      outcome := 'already_member';
      return next;
      continue;
    end if;

    select * into v_inv from public.group_email_invites x where x.group_id = p_group_id and x.email = v_email;
    if found and v_inv.status = 'pending' and v_user is null then
      invite_id := v_inv.id; outcome := 'already_invited'; failure := v_inv.failure;
      return next;
      continue;
    end if;

    if found then
      update public.group_email_invites x
         set status = 'pending', failure = null, invited_by = me, created_at = now(),
             first_name = coalesce(v_first, x.first_name), last_name = coalesce(v_last, x.last_name),
             joined_member_id = null, joined_at = null
       where x.id = v_inv.id
       returning * into v_inv;
    else
      insert into public.group_email_invites (group_id, email, first_name, last_name, invited_by)
      values (p_group_id, v_email, v_first, v_last, me)
      returning * into v_inv;
    end if;
    invite_id := v_inv.id;

    if v_user is not null then
      perform public.claim_group_email_invites_for(v_user, v_email);
      select * into v_inv from public.group_email_invites x where x.id = v_inv.id;
      if v_inv.status = 'joined' then
        outcome := 'added'; token := v_inv.token;
      else
        outcome := 'not_added'; failure := v_inv.failure;
      end if;
    else
      outcome := 'invited'; token := v_inv.token;
    end if;
    return next;
  end loop;
end;
$$;
revoke all on function public.import_group_email_invites(bigint, jsonb) from public, anon, authenticated;
grant execute on function public.import_group_email_invites(bigint, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Resend: hands back the pending invites' tokens to email again, and counts
-- the send. At most once an hour per invite, so a double click can't spam.
-- ---------------------------------------------------------------------------
create or replace function public.resend_group_email_invites(p_group_id bigint, p_ids bigint[])
returns table (invite_id bigint, email text, first_name text, token text)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.society_can(p_group_id, (select auth.uid()), 'people') then
    raise exception 'Only the society''s captain or secretary can do that.' using errcode = '42501';
  end if;
  return query
    select x.id, x.email, x.first_name, x.token
      from public.group_email_invites x
     where x.group_id = p_group_id
       and x.id = any(coalesce(p_ids, '{}'))
       and x.status = 'pending'
       and (x.emailed_at is null or x.emailed_at < now() - interval '1 hour');
end;
$$;
revoke all on function public.resend_group_email_invites(bigint, bigint[]) from public, anon, authenticated;
grant execute on function public.resend_group_email_invites(bigint, bigint[]) to authenticated;

-- Stamps the sends that went out (called after the email provider said yes).
create or replace function public.mark_group_email_invites_sent(p_group_id bigint, p_ids bigint[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n integer;
begin
  if not public.society_can(p_group_id, (select auth.uid()), 'people') then
    raise exception 'Only the society''s captain or secretary can do that.' using errcode = '42501';
  end if;
  update public.group_email_invites
     set emailed_at = now(), email_count = email_count + 1
   where group_id = p_group_id and id = any(coalesce(p_ids, '{}'));
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function public.mark_group_email_invites_sent(bigint, bigint[]) from public, anon, authenticated;
grant execute on function public.mark_group_email_invites_sent(bigint, bigint[]) to authenticated;

create or replace function public.cancel_group_email_invite(p_group_id bigint, p_invite_id bigint)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.society_can(p_group_id, (select auth.uid()), 'people') then
    raise exception 'Only the society''s captain or secretary can do that.' using errcode = '42501';
  end if;
  update public.group_email_invites
     set status = 'cancelled'
   where group_id = p_group_id and id = p_invite_id and status = 'pending';
  return found;
end;
$$;
revoke all on function public.cancel_group_email_invite(bigint, bigint) from public, anon, authenticated;
grant execute on function public.cancel_group_email_invite(bigint, bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- The email's link (/join/s/<token>): what it's for, before signing in.
-- ---------------------------------------------------------------------------
create or replace function public.group_email_invite_preview(p_token text)
returns table (group_id bigint, name text, kind text, about text, member_count integer, club_name text, owner_first_name text,
               logo_url text, email text, first_name text, status text)
language sql
stable
security definer
set search_path = public
as $$
  select g.id, g.name, g.kind, g.about, g.member_count, c.name, p.first_name,
         g.logo_url, x.email, x.first_name, x.status
    from public.group_email_invites x
    join public.groups g on g.id = x.group_id and g.hidden_at is null
    left join public.clubs c on c.id = g.club_id
    left join public.group_members o on o.group_id = g.id and o.role = 'owner'
    left join public.profiles p on p.id = o.member_id
   where x.token = btrim(coalesce(p_token, ''))
     and length(btrim(coalesce(p_token, ''))) = 64;
$$;
revoke all on function public.group_email_invite_preview(text) from public, anon, authenticated;
grant execute on function public.group_email_invite_preview(text) to anon, authenticated;

-- Signed in with the link: join with this account, whatever its email.
create or replace function public.claim_group_email_invite(p_token text)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := (select auth.uid());
  v_inv public.group_email_invites%rowtype;
begin
  if me is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  select * into v_inv from public.group_email_invites
   where token = btrim(coalesce(p_token, '')) for update;
  if not found or v_inv.status = 'cancelled' then
    raise exception 'That invitation isn''t valid any more — ask the society for a new one.';
  end if;
  if v_inv.status = 'joined' then
    if v_inv.joined_member_id = me or public.is_group_member(v_inv.group_id, me) then
      return v_inv.group_id;
    end if;
    raise exception 'That invitation has already been used.';
  end if;
  perform public.group_add_member(v_inv.group_id, me);
  update public.group_email_invites
     set status = 'joined', joined_member_id = me, joined_at = now(), failure = null
   where id = v_inv.id;
  return v_inv.group_id;
end;
$$;
revoke all on function public.claim_group_email_invite(text) from public, anon, authenticated;
grant execute on function public.claim_group_email_invite(text) to authenticated;
