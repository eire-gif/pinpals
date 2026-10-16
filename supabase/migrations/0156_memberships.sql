-- 0156 — Memberships: Basic / Premium / Pro (Oct 2026)
--
-- Premium features members can pay for with a yearly or monthly subscription
-- bought through the App Store or Google Play. See claude/memberships.md.
--
-- Shape:
--   * membership_settings  — one row: the master switch (paid_plans_enabled,
--                            OFF), a "free for everyone until" date, the prices
--                            the app displays and the free-trial lengths.
--   * membership_features  — the catalogue: each feature that can be paid
--                            for, and which level it needs (off / free /
--                            premium / pro). Superadmin edits it from
--                            /admin/monetisation.
--   * member_entitlements  — who has Premium or Pro and until when. Written
--                            only by the service role (the store webhook, to
--                            come, and staff grants).
--
-- Members reach two functions:
--   * my_membership()      — my level, the switch, the prices.
--   * my_feature_access()  — every feature, whether I may use it and, if
--                            not, whether to show it locked or hide it.
--
-- THE RULE (mirrored in src/lib/memberships.ts — keep the two in step):
--   off       → nobody
--   free      → everyone
--   while paid plans are switched off, or today is on/before free_until
--             → everything that isn't off is free
--   keep_for_existing, and the member joined before the feature went paid
--             → allowed
--   premium   → Premium or Pro members
--   pro       → Pro members
--
-- Additive only. paid_plans_enabled defaults to FALSE, so applying this
-- changes nothing a member sees: every feature that isn't 'off' is free.
--
-- Rollback (reverse order):
--   drop function if exists public.my_feature_access();
--   drop function if exists public.my_membership();
--   drop function if exists public.membership_tier_for(uuid);
--   drop trigger if exists membership_features_paywalled on public.membership_features;
--   drop trigger if exists membership_settings_live on public.membership_settings;
--   drop function if exists public.membership_features_stamp();
--   drop function if exists public.membership_settings_stamp();
--   drop table if exists public.member_entitlements, public.membership_features, public.membership_settings;

-- ---------------------------------------------------------------------------
-- Settings (one row)
-- ---------------------------------------------------------------------------

create table if not exists public.membership_settings (
  id boolean primary key default true check (id),
  paid_plans_enabled boolean not null default false,
  -- Set when the switch goes on; the "existing members" cut-off for
  -- keep_for_existing. Cleared when it goes off again.
  paid_plans_since timestamptz,
  free_until date,
  premium_monthly_price text not null default '€4.99' check (char_length(premium_monthly_price) between 1 and 20),
  premium_annual_price text not null default '€34.99' check (char_length(premium_annual_price) between 1 and 20),
  pro_monthly_price text not null default '€9.99' check (char_length(pro_monthly_price) between 1 and 20),
  pro_annual_price text not null default '€69.99' check (char_length(pro_annual_price) between 1 and 20),
  premium_trial_days smallint not null default 7 check (premium_trial_days in (0, 7, 14)),
  pro_trial_days smallint not null default 7 check (pro_trial_days in (0, 7, 14)),
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);

insert into public.membership_settings (id) values (true) on conflict (id) do nothing;

comment on table public.membership_settings is
  'Membership master switch, launch offer and displayed prices (0156). One row. paid_plans_enabled off = every feature free.';

create or replace function public.membership_settings_stamp()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.paid_plans_enabled and (tg_op = 'INSERT' or not old.paid_plans_enabled) then
    new.paid_plans_since := now();
  elsif not new.paid_plans_enabled then
    new.paid_plans_since := null;
  end if;
  return new;
end;
$$;

drop trigger if exists membership_settings_live on public.membership_settings;
create trigger membership_settings_live
  before insert or update on public.membership_settings
  for each row execute function public.membership_settings_stamp();

-- ---------------------------------------------------------------------------
-- Feature catalogue
-- ---------------------------------------------------------------------------

create table if not exists public.membership_features (
  key text primary key check (key ~ '^[a-z][a-z0-9_]{1,39}$'),
  group_key text not null check (group_key in ('scoring', 'social', 'societies')),
  name text not null check (char_length(btrim(name)) between 2 and 80),
  description text not null default '' check (char_length(description) <= 300),
  sort smallint not null default 0,
  access text not null default 'free' check (access in ('off', 'free', 'premium', 'pro')),
  -- When a member can't use it: show it with an upgrade prompt, or hide it.
  when_locked text not null default 'upsell' check (when_locked in ('upsell', 'hide')),
  -- Members who joined before it went paid keep it free.
  keep_for_existing boolean not null default false,
  -- When it last moved from off/free to premium/pro. Null while off or free.
  paywalled_at timestamptz,
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);

comment on table public.membership_features is
  'Features that can need Premium or Pro, and the level each needs (0156). Edited from /admin/monetisation.';

create or replace function public.membership_features_stamp()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.access in ('premium', 'pro') then
    if tg_op = 'INSERT' or old.access in ('off', 'free') then
      new.paywalled_at := now();
    end if;
  else
    new.paywalled_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists membership_features_paywalled on public.membership_features;
create trigger membership_features_paywalled
  before insert or update on public.membership_features
  for each row execute function public.membership_features_stamp();

-- The recommended split (claude/memberships.md). With paid plans switched
-- off, every one of these is free; the levels only bite once the switch is on.
insert into public.membership_features (key, group_key, name, description, sort, access, keep_for_existing) values
  ('live_scoring',     'scoring',   'Live scoring — all formats',          'Stableford, stroke, matchplay, foursomes, scramble. Keep free: it brings new golfers in.', 10, 'free', false),
  ('lock_screen',      'scoring',   'Lock-screen score entry',             'Live Activity card to enter scores without opening the app.', 20, 'free', false),
  ('certification',    'scoring',   'Face ID scorecard certification',     'A playing partner certifies the card on their own phone.', 30, 'free', false),
  ('gps_yardages',     'scoring',   'GPS yardages & satellite hole maps',  'Front / middle / back distances and shot tracking on satellite maps.', 40, 'premium', true),
  ('voice_scoring',    'scoring',   'Voice score entry',                   'Say scores in the app or from the lock-screen mic.', 50, 'premium', false),
  ('stats',            'scoring',   'Stats & insights',                    'Fairways, greens, putts, trends, best and worst holes per course.', 60, 'premium', true),
  ('round_history',    'scoring',   'Unlimited round history',             'Basic keeps the last 20 rounds.', 70, 'premium', false),
  ('ad_free',          'social',    'Ad-free app',                         'Removes full-page takeovers and banners.', 10, 'premium', false),
  ('featured_listings','social',    'Featured marketplace listings',       'Top-of-list placement, more photos and a Featured badge.', 20, 'premium', false),
  ('saved_searches',   'social',    'Saved searches & price-drop alerts',  'Notify when a matching club is listed or reduced.', 30, 'premium', false),
  ('tee_time_alerts',  'social',    'Priority tee-time alerts',            'First to hear when friends or your clubs post tee times.', 40, 'premium', false),
  ('member_badge',     'social',    'Member badge on profile',             'Premium or Pro badge beside the name.', 50, 'premium', false),
  ('competitions',     'societies', 'Competition engine',                  '1st/2nd/3rd with countbacks, matchplay league tables, open competitions.', 10, 'pro', false),
  ('clubhouse_tv',     'societies', 'Live TV leaderboard',                 'Clubhouse and bar screens with birdie flashes.', 20, 'pro', false),
  ('trip_itineraries', 'societies', 'Trip itineraries & PDF export',       'Day-by-day builder, share to social, printable pack.', 30, 'pro', false),
  ('society_admin',    'societies', 'Society admin tools',                 'Annual membership fees, payment tracking, bulk invites, CSV export.', 40, 'pro', false),
  ('society_branding', 'societies', 'Society branding',                    'Logo and colours on the society page, results and TV board.', 50, 'pro', false),
  ('large_societies',  'societies', 'Societies over 30 members',           'Smaller societies stay free.', 60, 'pro', false)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Entitlements
-- ---------------------------------------------------------------------------

create table if not exists public.member_entitlements (
  member_id uuid primary key references public.profiles (id) on delete cascade,
  tier text not null check (tier in ('premium', 'pro')),
  source text not null check (source in ('app_store', 'play_store', 'staff_grant')),
  product_id text check (product_id is null or char_length(product_id) <= 120),
  billing text check (billing is null or billing in ('monthly', 'annual')),
  -- Null = no end date (a staff grant). Past = lapsed: the member is Basic.
  expires_at timestamptz,
  in_trial boolean not null default false,
  will_renew boolean not null default true,
  granted_by uuid references public.profiles (id) on delete set null,
  note text check (note is null or char_length(note) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.member_entitlements is
  'Who has Premium or Pro (0156). Service role only: the store webhook and staff grants.';

-- ---------------------------------------------------------------------------
-- RLS and grants: staff read everything, a member reads their own
-- entitlement, nobody but the service role writes.
-- ---------------------------------------------------------------------------

alter table public.membership_settings enable row level security;
alter table public.membership_features enable row level security;
alter table public.member_entitlements enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['membership_settings', 'membership_features', 'member_entitlements'] loop
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = 'Staff read memberships') then
      execute format('create policy "Staff read memberships" on public.%I for select to authenticated using (public.is_staff())', t);
    end if;
    execute format('revoke insert, update, delete, truncate, references, trigger on public.%I from anon, authenticated', t);
    execute format('revoke select on public.%I from anon', t);
  end loop;
end $$;

drop policy if exists "Members read own entitlement" on public.member_entitlements;
create policy "Members read own entitlement" on public.member_entitlements
  for select to authenticated using (member_id = auth.uid());

revoke all on function public.membership_settings_stamp() from public, anon, authenticated;
revoke all on function public.membership_features_stamp() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- A member's current level
-- ---------------------------------------------------------------------------

create or replace function public.membership_tier_for(p_member uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select e.tier from public.member_entitlements e
      where e.member_id = p_member and (e.expires_at is null or e.expires_at > now())),
    'basic');
$$;

revoke all on function public.membership_tier_for(uuid) from public, anon, authenticated;

-- My level, the switch and the prices the app shows.
create or replace function public.my_membership()
returns table (
  tier text,
  paid_plans_enabled boolean,
  free_until date,
  billing text,
  source text,
  expires_at timestamptz,
  in_trial boolean,
  will_renew boolean,
  premium_monthly_price text,
  premium_annual_price text,
  pro_monthly_price text,
  pro_annual_price text,
  premium_trial_days smallint,
  pro_trial_days smallint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    public.membership_tier_for(auth.uid()),
    s.paid_plans_enabled,
    s.free_until,
    e.billing,
    e.source,
    e.expires_at,
    coalesce(e.in_trial, false),
    coalesce(e.will_renew, false),
    s.premium_monthly_price,
    s.premium_annual_price,
    s.pro_monthly_price,
    s.pro_annual_price,
    s.premium_trial_days,
    s.pro_trial_days
  from public.membership_settings s
  left join public.member_entitlements e
    on e.member_id = auth.uid() and (e.expires_at is null or e.expires_at > now())
  where s.id and auth.uid() is not null;
$$;

revoke all on function public.my_membership() from public, anon, authenticated;
grant execute on function public.my_membership() to authenticated;

-- Every feature, and whether I may use it right now.
create or replace function public.my_feature_access()
returns table (
  key text,
  access text,
  allowed boolean,
  when_locked text
)
language sql
stable
security definer
set search_path = public
as $$
  with s as (
    select * from public.membership_settings where membership_settings.id
  ),
  me as (
    select p.created_at as joined_at, public.membership_tier_for(p.id) as tier
    from public.profiles p
    where p.id = auth.uid()
  )
  select
    f.key,
    f.access,
    case
      when f.access = 'off' then false
      when f.access = 'free' then true
      when s.paid_plans_enabled is not true then true
      when s.free_until is not null and (now() at time zone 'Europe/Dublin')::date <= s.free_until then true
      when f.keep_for_existing
        and me.joined_at < greatest(coalesce(f.paywalled_at, '-infinity'::timestamptz), coalesce(s.paid_plans_since, '-infinity'::timestamptz))
        then true
      when f.access = 'premium' then me.tier in ('premium', 'pro')
      when f.access = 'pro' then me.tier = 'pro'
      else false
    end,
    f.when_locked
  from public.membership_features f
  cross join me
  left join s on true
  order by f.key;
$$;

revoke all on function public.my_feature_access() from public, anon, authenticated;
grant execute on function public.my_feature_access() to authenticated;
