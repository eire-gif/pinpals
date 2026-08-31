-- Pinpals: Milestone 1 schema (accounts, profiles, member search)
-- Run this in the Supabase SQL editor, or via the Supabase CLI / MCP tool.

-- ============ CLUBS ============
create table if not exists public.clubs (
  id bigint generated always as identity primary key,
  name text not null unique
);

alter table public.clubs enable row level security;

create policy "clubs are readable by everyone"
  on public.clubs for select
  using (true);

-- ============ PROFILES ============
-- One row per authenticated user, keyed to auth.users.
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  first_name text not null,
  last_name text not null,
  home_club text references public.clubs (name),
  county text,
  handicap numeric(4,1),
  bio text,
  avatar_color text default '#1f5c2e',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Any signed-in golfer can browse the directory.
create policy "profiles are readable by authenticated users"
  on public.profiles for select
  to authenticated
  using (true);

-- A user can only create/edit/delete their own profile row.
create policy "users can insert their own profile"
  on public.profiles for insert
  to authenticated
  with check (auth.uid() = id);

create policy "users can update their own profile"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

create policy "users can delete their own profile"
  on public.profiles for delete
  to authenticated
  using (auth.uid() = id);

-- Keep updated_at current on every edit.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row
  execute function public.set_updated_at();

-- Auto-create a blank-ish profile row the moment someone signs up,
-- so the app can always assume a profiles row exists once auth.users does.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, first_name, last_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'first_name', 'New'),
    coalesce(new.raw_user_meta_data->>'last_name', 'Golfer')
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();

-- Helpful indexes for the directory search/filter page.
create index if not exists profiles_county_idx on public.profiles (county);
create index if not exists profiles_home_club_idx on public.profiles (home_club);
