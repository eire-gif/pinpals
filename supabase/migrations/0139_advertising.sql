-- 0139 — In-app advertising (Oct 2026)
--
-- PinPals sells advertising space to golf travel, equipment and hospitality
-- businesses: a full-screen TAKEOVER (on app open and/or after a round is
-- certified), a slide-up BANNER (Courses, Marketplace), a sponsored card in
-- the FEED, and a COURSE PARTNER strip on a course page and its hole map.
-- See claude/advertising.md.
--
-- Shape:
--   * advertisers     — who is paying (staff only).
--   * ad_campaigns    — one advert: format, creative, audience, schedule,
--                       status and what the advertiser pays (staff only;
--                       members never read this table — see ads_for_me()).
--   * ad_settings     — one row: the master switch and the house rules.
--   * ad_events       — de-duplicated view/click/dismiss events.
--   * ad_daily_stats  — per campaign per UTC day rollup, kept by ad_log().
--
-- Every write to these tables is the service role's (the website's admin
-- Server Actions, each audited) or ad_log()'s. Members and visitors reach
-- exactly two functions: ads_for_me() (display fields of live adverts that
-- target them) and ad_log() (count a view/click/dismiss).
--
-- Billable counting is de-duplicated so nobody can inflate an advertiser's
-- bill by tapping: a signed-in member's view counts once per campaign per
-- clock hour (UTC), a click once per campaign per UTC day, a dismiss once per
-- campaign per hour. Anonymous (website) views and clicks are counted in
-- separate anon_* columns and never billed. A CPM/CPC campaign that reaches
-- its budget cap is ended by ad_log() and stops serving at once (ads_for_me()
-- also refuses a capped campaign, belt and braces).
--
-- Nothing here touches marketplace_banners (0115): those keep working as
-- they are and the advertising report shows their fees alongside, read-only.
--
-- Additive only: new tables, functions and a storage bucket. ads_enabled
-- defaults to FALSE, so applying this changes nothing a member sees.
--
-- Rollback (reverse order):
--   drop function if exists public.ad_log(bigint, text, text);
--   drop function if exists public.ads_for_me(text, text, bigint);
--   drop function if exists public.ad_campaign_capped(text, numeric, numeric, bigint, bigint);
--   drop table if exists public.ad_daily_stats, public.ad_events, public.ad_settings,
--     public.ad_campaigns, public.advertisers;
--   delete from storage.buckets where id = 'ad-creatives';  -- after emptying it

-- ---------------------------------------------------------------------------
-- Advertisers
-- ---------------------------------------------------------------------------

create table if not exists public.advertisers (
  id bigint generated always as identity primary key,
  name text not null check (char_length(btrim(name)) between 2 and 120),
  contact_name text check (contact_name is null or char_length(contact_name) <= 120),
  email text check (email is null or (char_length(email) <= 200 and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')),
  phone text check (phone is null or char_length(phone) <= 40),
  website text check (website is null or (char_length(website) <= 500 and website ~ '^https?://')),
  logo_url text check (logo_url is null or (char_length(logo_url) <= 500 and logo_url ~ '^https://')),
  notes text check (notes is null or char_length(notes) <= 4000),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.advertisers is 'Businesses that buy advertising on PinPals (0139). Staff only.';

-- ---------------------------------------------------------------------------
-- Campaigns
-- ---------------------------------------------------------------------------

create table if not exists public.ad_campaigns (
  id bigint generated always as identity primary key,
  advertiser_id bigint not null references public.advertisers (id) on delete restrict,
  name text not null check (char_length(btrim(name)) between 2 and 120),
  category text not null default 'other'
    check (category in ('golf_travel', 'equipment', 'hospitality', 'other', 'alcohol', 'betting')),
  format text not null check (format in ('takeover', 'banner', 'feed', 'course_partner')),
  -- artwork: the advertiser's finished image, shown as is (PinPals only adds
  -- the Sponsored label, countdown and close). photo_headline: a plain photo
  -- with headline/body/button laid out by PinPals.
  display_style text not null default 'artwork' check (display_style in ('artwork', 'photo_headline')),
  countdown_seconds smallint not null default 5 check (countdown_seconds in (3, 5)),
  takeover_placement text not null default 'app_open' check (takeover_placement in ('app_open', 'after_round', 'both')),
  image_url text check (image_url is null or (char_length(image_url) <= 500 and image_url ~ '^https://')),
  image_wide_url text check (image_wide_url is null or (char_length(image_wide_url) <= 500 and image_wide_url ~ '^https://')),
  image_square_url text check (image_square_url is null or (char_length(image_square_url) <= 500 and image_square_url ~ '^https://')),
  headline text check (headline is null or char_length(headline) between 1 and 60),
  body text check (body is null or char_length(body) <= 160),
  button_text text check (button_text is null or char_length(button_text) between 1 and 24),
  link_url text not null check (char_length(link_url) <= 1000 and link_url ~ '^https://[^[:space:]]+$'),
  -- PinPals' own country codes (profiles.country: 'ireland', 'northern-ireland',
  -- 'england', …). Empty = everywhere.
  countries text[] not null default '{}' check (cardinality(countries) <= 20),
  -- Counties / regions (profiles.county), matched case-insensitively. Empty = all.
  regions text[] not null default '{}' check (cardinality(regions) <= 80),
  -- course_partner: the courses it sponsors. Other formats: the member's home
  -- club must be one of these. Empty = no course targeting.
  club_ids bigint[] not null default '{}' check (cardinality(club_ids) <= 200),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  status text not null default 'draft'
    check (status in ('draft', 'pending_approval', 'approved', 'paused', 'ended', 'rejected')),
  weight integer not null default 1 check (weight between 1 and 100),
  pricing_model text not null default 'flat' check (pricing_model in ('flat', 'cpm', 'cpc')),
  -- flat: the whole deal. cpm: price per 1,000 billable views. cpc: per billable click.
  rate_eur numeric(10, 2) not null default 0 check (rate_eur >= 0),
  budget_cap_eur numeric(10, 2) check (budget_cap_eur is null or budget_cap_eur > 0),
  payment_status text not null default 'unpaid' check (payment_status in ('unpaid', 'invoiced', 'paid', 'waived')),
  -- Alcohol and betting adverts need a named staff member to tick "I've
  -- checked this is suitable" before approval (see the check below).
  sensitive_ack_by uuid references public.profiles (id) on delete set null,
  sensitive_ack_at timestamptz,
  reject_reason text check (reject_reason is null or char_length(reject_reason) <= 1000),
  end_reason text check (end_reason is null or end_reason in ('manual', 'budget_cap')),
  ended_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  approved_by uuid references public.profiles (id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ad_campaigns_dates check (ends_at is null or ends_at > starts_at),
  constraint ad_campaigns_flat_needs_end check (pricing_model <> 'flat' or ends_at is not null),
  constraint ad_campaigns_sensitive_approved check (
    category not in ('alcohol', 'betting') or status not in ('approved', 'paused') or sensitive_ack_at is not null
  ),
  constraint ad_campaigns_course_partner_clubs check (
    format <> 'course_partner' or status in ('draft', 'rejected') or cardinality(club_ids) > 0
  ),
  constraint ad_campaigns_ready check (status in ('draft', 'rejected') or image_url is not null),
  constraint ad_campaigns_headline_ready check (
    display_style <> 'photo_headline' or status in ('draft', 'rejected') or headline is not null
  )
);

create index if not exists ad_campaigns_advertiser_idx on public.ad_campaigns (advertiser_id);
create index if not exists ad_campaigns_serving_idx on public.ad_campaigns (status, format, starts_at);

comment on table public.ad_campaigns is 'Adverts (0139). Staff only; members get display fields of live, targeted adverts from ads_for_me().';

-- ---------------------------------------------------------------------------
-- Settings: one row
-- ---------------------------------------------------------------------------

create table if not exists public.ad_settings (
  id boolean primary key default true check (id),
  ads_enabled boolean not null default false,
  takeover_min_hours_between integer not null default 4 check (takeover_min_hours_between between 0 and 168),
  new_member_ad_free_days integer not null default 7 check (new_member_ad_free_days between 0 and 365),
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);

insert into public.ad_settings (id) values (true) on conflict (id) do nothing;

comment on table public.ad_settings is 'Advertising master switch and house rules (0139). One row. ads_enabled off = no advert anywhere.';

-- ---------------------------------------------------------------------------
-- Events and the daily rollup
-- ---------------------------------------------------------------------------

create table if not exists public.ad_events (
  id bigint generated always as identity primary key,
  campaign_id bigint not null references public.ad_campaigns (id) on delete cascade,
  member_id uuid references public.profiles (id) on delete set null,
  kind text not null check (kind in ('view', 'click', 'dismiss')),
  source text not null check (source in ('app', 'web')),
  -- Start of the de-duplication window this event counted for: the clock
  -- hour for views and dismisses, the UTC day for clicks. Null when anonymous.
  bucket timestamptz,
  anonymous boolean not null default false,
  created_at timestamptz not null default now()
);

-- The de-duplication itself: one row per member, campaign, kind and window.
create unique index if not exists ad_events_dedupe_idx
  on public.ad_events (campaign_id, member_id, kind, bucket) where member_id is not null;
create index if not exists ad_events_campaign_idx on public.ad_events (campaign_id, created_at);
create index if not exists ad_events_member_idx on public.ad_events (member_id, created_at) where member_id is not null;

create table if not exists public.ad_daily_stats (
  campaign_id bigint not null references public.ad_campaigns (id) on delete cascade,
  day date not null,
  views integer not null default 0 check (views >= 0),
  clicks integer not null default 0 check (clicks >= 0),
  dismisses integer not null default 0 check (dismisses >= 0),
  anon_views integer not null default 0 check (anon_views >= 0),
  anon_clicks integer not null default 0 check (anon_clicks >= 0),
  primary key (campaign_id, day)
);

comment on column public.ad_daily_stats.views is 'Billable views (0139): signed-in members, once per member per campaign per clock hour.';
comment on column public.ad_daily_stats.clicks is 'Billable clicks (0139): signed-in members, once per member per campaign per UTC day.';
comment on column public.ad_daily_stats.anon_views is 'Signed-out website views (0139): counted, flagged, never billed.';

-- ---------------------------------------------------------------------------
-- RLS: staff read; nobody but the service role and ad_log() writes
-- ---------------------------------------------------------------------------

alter table public.advertisers enable row level security;
alter table public.ad_campaigns enable row level security;
alter table public.ad_settings enable row level security;
alter table public.ad_events enable row level security;
alter table public.ad_daily_stats enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['advertisers', 'ad_campaigns', 'ad_settings', 'ad_events', 'ad_daily_stats'] loop
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = 'Staff read advertising') then
      execute format('create policy "Staff read advertising" on public.%I for select to authenticated using (public.is_staff())', t);
    end if;
    execute format('revoke insert, update, delete, truncate, references, trigger on public.%I from anon, authenticated', t);
    execute format('revoke select on public.%I from anon', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Budget cap: the same rule as src/lib/advertising-revenue.ts
-- ---------------------------------------------------------------------------

-- cpm: views × rate ÷ 1000; cpc: clicks × rate. Capped once that reaches the
-- cap. Flat deals have no cap (their price is fixed).
create or replace function public.ad_campaign_capped(p_model text, p_rate numeric, p_cap numeric, p_views bigint, p_clicks bigint)
returns boolean
language sql
immutable
set search_path = public
as $$
  select p_cap is not null and case p_model
    when 'cpm' then p_views * p_rate / 1000 >= p_cap
    when 'cpc' then p_clicks * p_rate >= p_cap
    else false
  end;
$$;

revoke all on function public.ad_campaign_capped(text, numeric, numeric, bigint, bigint) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- ads_for_me(): the adverts this caller may see right now
-- ---------------------------------------------------------------------------
--
-- Applies, server-side: the master switch; approved + inside its dates + not
-- capped; the new-member ad-free period; country / county / course
-- targeting; and the takeover frequency cap (no takeover if this member
-- viewed one within takeover_min_hours_between). Returns display fields only
-- — never the price, the advertiser's contact details or the status.
--
-- Targeting falls back to the member's own profile when an argument is null.
-- p_club_id is the course being looked at (course page, hole map) or, at app
-- start, the member's home club.
create or replace function public.ads_for_me(p_country text default null, p_region text default null, p_club_id bigint default null)
returns table (
  id bigint,
  format text,
  display_style text,
  countdown_seconds smallint,
  takeover_placement text,
  image_url text,
  image_wide_url text,
  image_square_url text,
  headline text,
  body text,
  button_text text,
  link_url text,
  advertiser_name text,
  advertiser_logo_url text,
  weight integer,
  countries text[],
  regions text[],
  takeover_gap_hours integer
)
language sql
stable
security definer
set search_path = public
as $$
  with s as (
    select * from public.ad_settings where ad_settings.id
  ),
  me as (
    select p.id as member_id, p.created_at, p.country, p.county, p.home_club_id
      from public.profiles p
     where p.id = (select auth.uid())
  ),
  who as (
    select
      (select member_id from me) as member_id,
      (select created_at from me) as joined_at,
      coalesce(nullif(btrim(p_country), ''), (select country from me)) as country,
      lower(coalesce(nullif(btrim(p_region), ''), (select county from me))) as region,
      coalesce(p_club_id, (select home_club_id from me)) as club_id
  ),
  totals as (
    select d.campaign_id, sum(d.views)::bigint as views, sum(d.clicks)::bigint as clicks
      from public.ad_daily_stats d
     group by d.campaign_id
  )
  select c.id, c.format, c.display_style, c.countdown_seconds, c.takeover_placement,
         c.image_url, c.image_wide_url, c.image_square_url, c.headline, c.body, c.button_text, c.link_url,
         a.name, a.logo_url, c.weight, c.countries, c.regions, s.takeover_min_hours_between
    from public.ad_campaigns c
    join public.advertisers a on a.id = c.advertiser_id
    cross join s
    cross join who
    left join totals t on t.campaign_id = c.id
   where s.ads_enabled
     and c.status = 'approved'
     and c.starts_at <= now()
     and (c.ends_at is null or c.ends_at > now())
     and c.image_url is not null
     and not public.ad_campaign_capped(c.pricing_model, c.rate_eur, c.budget_cap_eur, coalesce(t.views, 0), coalesce(t.clicks, 0))
     -- New members get a quiet first week (or whatever the house rule says).
     and (who.joined_at is null or who.joined_at <= now() - make_interval(days => s.new_member_ad_free_days))
     and (cardinality(c.countries) = 0 or who.country = any (c.countries))
     and (cardinality(c.regions) = 0 or exists (select 1 from unnest(c.regions) r where lower(r) = who.region))
     and (cardinality(c.club_ids) = 0 or who.club_id = any (c.club_ids))
     and (
       c.format <> 'takeover'
       or who.member_id is null
       or not exists (
         select 1
           from public.ad_events e
           join public.ad_campaigns c2 on c2.id = e.campaign_id
          where e.member_id = who.member_id
            and e.kind = 'view'
            and c2.format = 'takeover'
            and e.created_at > now() - make_interval(hours => s.takeover_min_hours_between)
       )
     )
   order by c.weight desc, c.id
   limit 50;
$$;

revoke all on function public.ads_for_me(text, text, bigint) from public, anon, authenticated;
grant execute on function public.ads_for_me(text, text, bigint) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- ad_log(): count a view, click or dismiss
-- ---------------------------------------------------------------------------
--
-- Only a live campaign can be logged against (raises otherwise). Returns the
-- advert's link for a click (whether or not the click was billable), null
-- otherwise. Rate limits: a member past 60 events in a minute, or a campaign
-- past 600 anonymous events in a minute, is ignored rather than counted.
create or replace function public.ad_log(p_campaign_id bigint, p_kind text, p_source text)
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_c public.ad_campaigns;
  v_enabled boolean;
  v_now timestamptz := now();
  v_day date := (now() at time zone 'utc')::date;
  v_bucket timestamptz;
  v_counted boolean := false;
  v_views bigint;
  v_clicks bigint;
  v_link text;
begin
  if p_kind is null or p_kind not in ('view', 'click', 'dismiss') then
    raise exception 'Unknown advert event' using errcode = '22023';
  end if;
  if p_source is null or p_source not in ('app', 'web') then
    raise exception 'Unknown advert source' using errcode = '22023';
  end if;

  select s.ads_enabled into v_enabled from public.ad_settings s where s.id;
  select * into v_c from public.ad_campaigns where id = p_campaign_id;
  if not found or not coalesce(v_enabled, false) or v_c.status <> 'approved'
     or v_c.starts_at > v_now or (v_c.ends_at is not null and v_c.ends_at <= v_now) then
    raise exception 'That advert isn''t running' using errcode = 'P0002';
  end if;

  v_link := case when p_kind = 'click' then v_c.link_url end;

  if v_me is not null then
    if (select count(*) from public.ad_events where member_id = v_me and created_at > v_now - interval '1 minute') >= 60 then
      return v_link;
    end if;
    v_bucket := case when p_kind = 'click'
                     then (v_day::timestamp at time zone 'utc')
                     else date_trunc('hour', v_now) end;
    insert into public.ad_events (campaign_id, member_id, kind, source, bucket)
    values (p_campaign_id, v_me, p_kind, p_source, v_bucket)
    on conflict (campaign_id, member_id, kind, bucket) where member_id is not null do nothing;
    v_counted := found;
    if v_counted then
      insert into public.ad_daily_stats (campaign_id, day, views, clicks, dismisses)
      values (p_campaign_id, v_day,
              (p_kind = 'view')::int, (p_kind = 'click')::int, (p_kind = 'dismiss')::int)
      on conflict (campaign_id, day) do update
        set views = public.ad_daily_stats.views + excluded.views,
            clicks = public.ad_daily_stats.clicks + excluded.clicks,
            dismisses = public.ad_daily_stats.dismisses + excluded.dismisses;
    end if;
  else
    -- Signed out (the website): counted, flagged, never billed.
    if (select count(*) from public.ad_events
         where campaign_id = p_campaign_id and anonymous and created_at > v_now - interval '1 minute') >= 600 then
      return v_link;
    end if;
    insert into public.ad_events (campaign_id, member_id, kind, source, bucket, anonymous)
    values (p_campaign_id, null, p_kind, p_source, null, true);
    insert into public.ad_daily_stats (campaign_id, day, anon_views, anon_clicks, dismisses)
    values (p_campaign_id, v_day,
            (p_kind = 'view')::int, (p_kind = 'click')::int, (p_kind = 'dismiss')::int)
    on conflict (campaign_id, day) do update
      set anon_views = public.ad_daily_stats.anon_views + excluded.anon_views,
          anon_clicks = public.ad_daily_stats.anon_clicks + excluded.anon_clicks,
          dismisses = public.ad_daily_stats.dismisses + excluded.dismisses;
  end if;

  -- A CPM/CPC campaign that has spent its cap ends here and stops serving.
  if v_counted and v_c.budget_cap_eur is not null and v_c.pricing_model in ('cpm', 'cpc') then
    select coalesce(sum(views), 0), coalesce(sum(clicks), 0) into v_views, v_clicks
      from public.ad_daily_stats where campaign_id = p_campaign_id;
    if public.ad_campaign_capped(v_c.pricing_model, v_c.rate_eur, v_c.budget_cap_eur, v_views, v_clicks) then
      update public.ad_campaigns
         set status = 'ended', end_reason = 'budget_cap', ended_at = v_now, updated_at = v_now
       where id = p_campaign_id and status = 'approved';
    end if;
  end if;

  return v_link;
end;
$$;

revoke all on function public.ad_log(bigint, text, text) from public, anon, authenticated;
grant execute on function public.ad_log(bigint, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Storage: advert creatives
-- ---------------------------------------------------------------------------
--
-- Public (adverts are public by nature). No policies for anon/authenticated:
-- the only writer is the admin upload route (service role), which re-encodes
-- every image with sharp (metadata stripped) and checks its dimensions.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('ad-creatives', 'ad-creatives', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;
