-- Sign in with Apple and Google (Oct 2026, claude/social-sign-in.md).
--
-- Three things the database needs for members who join with one tap rather
-- than the sign-up form:
--
-- 1. A NAME. The form sends first_name / last_name in the sign-up metadata;
--    Google sends full_name / name (and sometimes given_name / family_name);
--    Apple sends nothing at all — the app passes on the name Apple gives it
--    the first time and saves it to the profile itself. handle_new_user (0001)
--    now reads any of those before falling back to "New Golfer".
--
-- 2. A DATE OF BIRTH BEFORE ANYTHING ELSE. The form asks for it before the
--    account exists (0159). A one-tap sign-up can't: Apple and Google create
--    the account first. Without this, such an account has no date of birth
--    and lands in the 'unknown' band — which 0159 treats as an adult, because
--    'unknown' was only ever meant for members from before juniors. So a new
--    Apple/Google account is put on member_dob_required, and age_band_of()
--    treats it as 'junior_pending' (signed in, nothing else) until a date of
--    birth is saved. my_age_access() then says needsDateOfBirth, and both the
--    app and the website ask for it straight away. Saving the date (with
--    set_my_date_of_birth, which 0159's guard holds to 13+) clears the hold
--    and the date decides the band, exactly as for a form sign-up. An existing
--    member who links Google to the same email creates no new auth.users row
--    and is never held.
--
-- 3. APPLE'S REFRESH TOKEN, so deleting an account can revoke the member's
--    Sign in with Apple grant, as App Store Guideline 5.1.1(v) asks. Only the
--    website's service role reads or writes it (src/lib/apple-sign-in.ts).

-- ===========================================================================
-- 1. Names from Apple / Google
-- ===========================================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_full text := nullif(btrim(coalesce(v_meta ->> 'full_name', v_meta ->> 'name', '')), '');
  v_first text := nullif(btrim(coalesce(v_meta ->> 'first_name', v_meta ->> 'given_name', '')), '');
  v_last text := nullif(btrim(coalesce(v_meta ->> 'last_name', v_meta ->> 'family_name', '')), '');
begin
  -- "Seán Ó Briain" → Seán / Ó Briain. One word → a first name only.
  if v_first is null and v_full is not null then
    v_first := split_part(v_full, ' ', 1);
    if v_last is null then
      v_last := nullif(btrim(substr(v_full, length(v_first) + 1)), '');
    end if;
  end if;
  -- Some providers put the email address where the name goes.
  if v_first like '%@%' then
    v_first := null;
    v_last := null;
  end if;

  insert into public.profiles (id, first_name, last_name)
  values (new.id, coalesce(left(v_first, 50), 'New'), coalesce(left(v_last, 50), 'Golfer'));
  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;

-- ===========================================================================
-- 2. Held until a date of birth is saved
-- ===========================================================================

create table if not exists public.member_dob_required (
  user_id uuid primary key references auth.users (id) on delete cascade,
  provider text not null,
  created_at timestamptz not null default now()
);

-- Nothing reads this directly but the definer functions below.
alter table public.member_dob_required enable row level security;
revoke all on table public.member_dob_required from anon, authenticated;

create or replace function public.member_dob_hold_on_signup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(new.raw_app_meta_data ->> 'provider', '') in ('apple', 'google')
     and not exists (select 1 from public.member_birthdates where user_id = new.id) then
    insert into public.member_dob_required (user_id, provider)
    values (new.id, new.raw_app_meta_data ->> 'provider')
    on conflict (user_id) do nothing;
  end if;
  return null;
end;
$$;

revoke all on function public.member_dob_hold_on_signup() from public, anon, authenticated;

-- After 0001's on_auth_user_created and 0159's on_auth_user_created_age
-- (same timing, so they run in name order).
drop trigger if exists on_auth_user_created_social on auth.users;
create trigger on_auth_user_created_social
  after insert on auth.users
  for each row execute function public.member_dob_hold_on_signup();

create or replace function public.member_dob_hold_release()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.member_dob_required where user_id = new.user_id;
  return null;
end;
$$;

revoke all on function public.member_dob_hold_release() from public, anon, authenticated;

drop trigger if exists member_dob_hold_release on public.member_birthdates;
create trigger member_dob_hold_release
  after insert on public.member_birthdates
  for each row execute function public.member_dob_hold_release();

-- As 0159, with one line added: no date of birth AND held → junior_pending.
create or replace function public.age_band_of(p_user uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_user is null then 'unknown'
    when b.user_id is null and h.user_id is not null then 'junior_pending'
    when b.user_id is null then case when f.user_id is not null then 'youth' else 'unknown' end
    when current_date < b.sixteen_on then
      case when exists (select 1 from public.guardian_links g
                         where g.junior_id = p_user and g.status = 'approved')
           then 'junior' else 'junior_pending' end
    when current_date < b.adult_on then 'youth'
    when f.user_id is not null then 'youth'
    else 'adult'
  end
  from (select p_user as u) x
  left join public.member_birthdates b on b.user_id = x.u
  left join public.member_age_flags f on f.user_id = x.u and f.resolved_at is null
  left join public.member_dob_required h on h.user_id = x.u;
$$;

revoke all on function public.age_band_of(uuid) from public, anon, authenticated;

-- As 0159, plus: a held account counts as a minor (its profile stays out of
-- sight, as a junior_pending one's does) until its date says otherwise.
create or replace function public.is_minor(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.member_birthdates b where b.user_id = p_user and current_date < b.adult_on)
      or exists (select 1 from public.member_age_flags f where f.user_id = p_user and f.resolved_at is null)
      or exists (select 1 from public.member_dob_required h where h.user_id = p_user);
$$;

revoke all on function public.is_minor(uuid) from public, anon, authenticated;

-- ===========================================================================
-- 3. Apple refresh tokens (service role only)
-- ===========================================================================

create table if not exists public.apple_sign_in_tokens (
  user_id uuid primary key references auth.users (id) on delete cascade,
  refresh_token text not null,
  updated_at timestamptz not null default now()
);

alter table public.apple_sign_in_tokens enable row level security;
revoke all on table public.apple_sign_in_tokens from anon, authenticated;
