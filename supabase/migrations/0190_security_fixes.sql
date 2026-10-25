-- Security fixes from the 25 Oct 2026 review. Paste in Supabase → SQL editor.
-- Each block is independent; all are safe to re-run.
-- None of these changes affects anything the website or app does today
-- (checked against src/ and mobile/src/ on commit 0ea83b3).

begin;

-- 1. Staff powers need the two-step code (this is migration 0135, never applied).
--    Both active super admins already have two-step set up, so nobody is locked out.
create or replace function public.is_staff(required_roles text[] default null)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.staff_roles sr
    where sr.user_id = auth.uid()
      and sr.status = 'active'
      and (required_roles is null or sr.role = any(required_roles))
  )
  and coalesce((select auth.jwt()) ->> 'aal', 'aal1') = 'aal2';
$$;
revoke all on function public.is_staff(text[]) from public, anon;
grant execute on function public.is_staff(text[]) to authenticated;

--    competition_staff() had its own copy of the check without the two-step test.
create or replace function public.competition_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_staff(array['admin', 'super_admin']);
$$;

-- 2. Members can no longer delete their own profile row directly.
--    (Delete + re-create wiped a junior's date of birth and parent link, and
--    wiped anyone's no-show record and marketplace feedback.)
--    Account deletion uses the server's admin client, so it is unaffected.
drop policy if exists "users can delete their own profile" on public.profiles;
revoke delete on public.profiles from anon, authenticated;

-- 3. Nobody can rewrite who a connection or a tee-time request belongs to.
--    (The recipient of a request could swap in any member — including a junior —
--    as the requester and mark it accepted; a host could put any member into a
--    round or mark them a no-show; a player could move their place to another round.)
create or replace function public.lock_row_parties()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  col text;
begin
  -- The server (service role) and database functions running without a member
  -- session keep full control; only member sessions are locked.
  if (select auth.uid()) is null then
    return new;
  end if;
  foreach col in array tg_argv loop
    if to_jsonb(new) -> col is distinct from to_jsonb(old) -> col then
      raise exception 'You can''t change % on this record', col
        using errcode = '42501';
    end if;
  end loop;
  return new;
end;
$$;
revoke all on function public.lock_row_parties() from public, anon, authenticated;

drop trigger if exists connections_lock_parties on public.connections;
create trigger connections_lock_parties
  before update on public.connections
  for each row execute function public.lock_row_parties('requester_id', 'recipient_id');

drop trigger if exists tee_time_interests_lock_parties on public.tee_time_interests;
create trigger tee_time_interests_lock_parties
  before update on public.tee_time_interests
  for each row execute function public.lock_row_parties('invite_id', 'member_id');

--    The junior-safety check on connections now also runs when one is edited.
drop trigger if exists connections_age_guard on public.connections;
create trigger connections_age_guard
  before insert or update on public.connections
  for each row execute function public.age_guard('connection');

-- 4. A junior can no longer read the parent-approval code for their own link.
--    (They could read it, sign in to any adult account and approve themselves.)
revoke select on public.guardian_links from authenticated;
grant select (id, junior_id, guardian_email, guardian_id, status, invited_at,
              consented_at, approved_at, card_checked_at, ended_at)
  on public.guardian_links to authenticated;

-- 5. Stop anyone listing every member's photo folder (incl. juniors').
--    Photos still load by their link; uploaders can still see their own files.
drop policy if exists "member avatars are publicly readable" on storage.objects;
drop policy if exists "member avatars: owner can list own" on storage.objects;
create policy "member avatars: owner can list own" on storage.objects
  for select to authenticated
  using (bucket_id = 'member-avatars' and owner = (select auth.uid()));

-- 6. Close the leftover "Temp anon" upload rules: anyone on the internet could
--    upload or overwrite any file, any type, any size, in this public bucket.
--    The bucket is empty and nothing in the site or app uses it.
drop policy if exists "Temp anon upload site-images" on storage.objects;
drop policy if exists "Temp anon update site-images" on storage.objects;

-- 7. The one-off course-import helpers made in the SQL editor could be run by
--    anyone on the internet (they call the paid golfapi.io import using the
--    stored secret). The imports are finished; drop them.
drop function if exists public.tmp_golfapi_run();
drop function if exists public.tmp_golfapi_search_run();
--    tmp_gk is only a text-tidying helper still used by the locked tmp view;
--    keep it but take it off the public API.
do $$ begin
  if to_regprocedure('public.tmp_gk(text)') is not null then
    revoke all on function public.tmp_gk(text) from public, anon, authenticated;
  end if;
end $$;

-- 8. member_age_bands: only for members you're allowed to see.
create or replace view public.member_age_bands
with (security_invoker = false) as
  select b.user_id,
    case
      when age(b.date_of_birth::timestamptz) < interval '25 years' then 'Under 25'
      when age(b.date_of_birth::timestamptz) < interval '35 years' then '25–34'
      when age(b.date_of_birth::timestamptz) < interval '45 years' then '35–44'
      when age(b.date_of_birth::timestamptz) < interval '55 years' then '45–54'
      when age(b.date_of_birth::timestamptz) < interval '65 years' then '55–64'
      else '65+'
    end as age_band
  from public.member_birthdates b
  where b.age_range_visible
    and public.profile_visible_to_me(b.user_id);

commit;
