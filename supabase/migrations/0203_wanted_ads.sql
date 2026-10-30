-- 0203 — Wanted ads (30 Oct 2026, claude/wanted-ads.md)
--
-- Asked by Eire, 30 Oct 2026 (canvas "PinPals Next Ideas", row 4, "build
-- it"). "Looking for a 3-wood, stiff, under €100": a member posts what they
-- want, and
--
--   - when a listing goes live that fits (same category; the shaft flex,
--     hand and county if they gave one; at or under their price), they get
--     a notification straight away (one per listing, never twice);
--   - a seller who lists something sees who's looking for one — the ones it
--     fits, and the "close" ones (up to a third over their price) — and can
--     send it to any of them, which is a notification too;
--   - signed-in members see the open wanted ads (first name and county),
--     except between members who've blocked each other.
--
-- An ad stays up for 30 days unless taken down; ten open at a time.
-- Notifications go through notify_user() (0056), dedupe key
-- "wanted-<ad>-<listing>", so a fit that's been told isn't told again by the
-- seller's tap. The only drop is "drop trigger if exists", so the file can
-- be run again.
--
-- Rollback:
--   drop trigger if exists listings_wanted_match on public.listings;
--   drop function if exists public.listings_wanted_match(), public.wanted_save(bigint, jsonb),
--     public.wanted_close(bigint), public.wanted_matches_for_listing(bigint),
--     public.wanted_send_listing(bigint, bigint), public.wanted_fit(public.wanted_ads, public.listings);
--   drop table if exists public.wanted_ads;

create table if not exists public.wanted_ads (
  id bigint generated always as identity primary key,
  member_id uuid not null references public.profiles (id) on delete cascade,
  category text not null check (category in ('Drivers', 'Woods & hybrids', 'Irons', 'Wedges', 'Putters', 'Full sets', 'Bags & trolleys', 'Shoes & apparel', 'Balls & accessories')),
  details text check (details is null or char_length(details) <= 120),
  shaft_flex text check (shaft_flex is null or shaft_flex in ('Ladies', 'Senior', 'Regular', 'Stiff', 'Extra stiff')),
  dexterity text check (dexterity is null or dexterity in ('Right-handed', 'Left-handed')),
  max_price_cents integer check (max_price_cents is null or max_price_cents between 100 and 10000000),
  -- Null: anywhere.
  county text check (county is null or char_length(county) between 2 and 40),
  status text not null default 'open' check (status in ('open', 'closed')),
  expires_at timestamptz not null default (now() + interval '30 days'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists wanted_ads_open_idx on public.wanted_ads (category, expires_at) where status = 'open';
create index if not exists wanted_ads_member_idx on public.wanted_ads (member_id, created_at desc);

comment on table public.wanted_ads is 'Wanted ads (0203): what a member is looking for on the marketplace. Matched to listings as they go live. Written only through wanted_save() / wanted_close().';

alter table public.wanted_ads enable row level security;
revoke all on public.wanted_ads from anon;
revoke insert, update, delete, truncate, references, trigger on public.wanted_ads from authenticated;
grant select on public.wanted_ads to authenticated;

create policy "Open wanted ads, and your own" on public.wanted_ads
  for select to authenticated using (
    member_id = (select auth.uid())
    or (status = 'open' and expires_at > now() and not public.is_blocked((select auth.uid()), member_id))
  );

-- p: { category, details?, shaft_flex?, dexterity?, max_price_cents?, county? }
create or replace function public.wanted_save(p_id bigint, p jsonb)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := (select auth.uid());
  v_cat text := nullif(btrim(coalesce(p ->> 'category', '')), '');
  v_details text := nullif(btrim(coalesce(p ->> 'details', '')), '');
  v_flex text := nullif(p ->> 'shaft_flex', '');
  v_hand text := nullif(p ->> 'dexterity', '');
  v_max integer := nullif(p ->> 'max_price_cents', '')::integer;
  v_county text := nullif(btrim(coalesce(p ->> 'county', '')), '');
  v_id bigint;
begin
  if me is null or not exists (select 1 from public.profiles where id = me and deleted_at is null) then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if v_cat is null or v_cat not in ('Drivers', 'Woods & hybrids', 'Irons', 'Wedges', 'Putters', 'Full sets', 'Bags & trolleys', 'Shoes & apparel', 'Balls & accessories') then
    raise exception 'Pick what you''re looking for.';
  end if;
  if v_details is not null and char_length(v_details) > 120 then raise exception 'Keep the details to 120 letters.'; end if;
  if v_flex is not null and v_flex not in ('Ladies', 'Senior', 'Regular', 'Stiff', 'Extra stiff') then raise exception 'Pick a shaft flex, or any.'; end if;
  if v_hand is not null and v_hand not in ('Right-handed', 'Left-handed') then raise exception 'Right or left-handed?'; end if;
  if v_max is not null and v_max not between 100 and 10000000 then raise exception 'Your price should be between €1 and €100,000.'; end if;
  if v_county is not null and char_length(v_county) not between 2 and 40 then raise exception 'Pick a county, or anywhere.'; end if;

  if p_id is null then
    if (select count(*) from public.wanted_ads where member_id = me and status = 'open' and expires_at > now()) >= 10 then
      raise exception 'You have ten wanted ads up already. Take one down first.';
    end if;
    insert into public.wanted_ads (member_id, category, details, shaft_flex, dexterity, max_price_cents, county)
    values (me, v_cat, v_details, v_flex, v_hand, v_max, v_county)
    returning id into v_id;
  else
    update public.wanted_ads
       set category = v_cat, details = v_details, shaft_flex = v_flex, dexterity = v_hand, max_price_cents = v_max,
           county = v_county, status = 'open', expires_at = now() + interval '30 days', updated_at = now()
     where id = p_id and member_id = me
    returning id into v_id;
    if v_id is null then raise exception 'That wanted ad isn''t yours.' using errcode = '42501'; end if;
  end if;
  return v_id;
end;
$$;
revoke all on function public.wanted_save(bigint, jsonb) from public, anon, authenticated;
grant execute on function public.wanted_save(bigint, jsonb) to authenticated;

create or replace function public.wanted_close(p_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.wanted_ads set status = 'closed', updated_at = now()
   where id = p_id and member_id = (select auth.uid());
  if not found then raise exception 'That wanted ad isn''t yours.' using errcode = '42501'; end if;
end;
$$;
revoke all on function public.wanted_close(bigint) from public, anon, authenticated;
grant execute on function public.wanted_close(bigint) to authenticated;

-- How a listing stands against a wanted ad: 'fits', 'close' (the rest fits,
-- but it's up to a third over their price), or null. Internal.
create or replace function public.wanted_fit(w public.wanted_ads, l public.listings)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when w.status <> 'open' or w.expires_at <= now() or w.member_id = l.seller_id then null
    when w.category <> l.category then null
    when w.shaft_flex is not null and l.shaft_flex is distinct from w.shaft_flex then null
    when w.dexterity is not null and l.dexterity is distinct from w.dexterity then null
    when w.county is not null and l.county is distinct from w.county then null
    when public.is_blocked(w.member_id, l.seller_id) then null
    when w.max_price_cents is null then 'fits'
    when coalesce(l.price_cents, round(l.price_eur * 100)::integer) is null then 'close'
    when coalesce(l.price_cents, round(l.price_eur * 100)::integer) <= w.max_price_cents then 'fits'
    when coalesce(l.price_cents, round(l.price_eur * 100)::integer) <= w.max_price_cents * 4 / 3 then 'close'
    else null
  end;
$$;
revoke all on function public.wanted_fit(public.wanted_ads, public.listings) from public, anon, authenticated;

-- A seller's listing: who's looking for one. The seller only.
create or replace function public.wanted_matches_for_listing(p_listing_id bigint)
returns table (wanted_id bigint, member_id uuid, first_name text, county text, category text, details text,
               shaft_flex text, max_price_cents integer, created_at timestamptz, fit text, told boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  l public.listings;
begin
  select * into l from public.listings where id = p_listing_id;
  if not found or l.seller_id is distinct from (select auth.uid()) then
    return;
  end if;
  return query
    select w.id, w.member_id, coalesce(nullif(btrim(pr.first_name), ''), 'A member'), w.county, w.category, w.details,
           w.shaft_flex, w.max_price_cents, w.created_at, public.wanted_fit(w, l),
           exists (select 1 from public.notifications n where n.user_id = w.member_id and n.dedupe_key = 'wanted-' || w.id || '-' || l.id)
      from public.wanted_ads w
      join public.profiles pr on pr.id = w.member_id and pr.deleted_at is null
     where w.category = l.category and public.wanted_fit(w, l) is not null
     order by public.wanted_fit(w, l) desc, w.created_at desc
     limit 30;
end;
$$;
revoke all on function public.wanted_matches_for_listing(bigint) from public, anon, authenticated;
grant execute on function public.wanted_matches_for_listing(bigint) to authenticated;

-- The seller sends their listing to someone looking for one.
create or replace function public.wanted_send_listing(p_wanted_id bigint, p_listing_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := (select auth.uid());
  l public.listings;
  w public.wanted_ads;
begin
  select * into l from public.listings where id = p_listing_id;
  if not found or l.seller_id is distinct from me then
    raise exception 'Only the seller can send their ad.' using errcode = '42501';
  end if;
  if l.status <> 'active' then raise exception 'Your ad isn''t live.'; end if;
  select * into w from public.wanted_ads where id = p_wanted_id;
  if not found or public.wanted_fit(w, l) is null then
    raise exception 'That wanted ad has gone, or your ad doesn''t fit it.';
  end if;
  perform public.notify_user(
    w.member_id,
    'wanted_match',
    public.marketplace_short_name(me) || ' has one for you',
    left(l.title, 120) || ' · ' || coalesce(public.format_euro_cents(coalesce(l.price_cents, round(l.price_eur * 100)::integer)), 'auction') || ' — for your wanted ad.',
    jsonb_build_object('href', '/marketplace/' || l.id, 'listingId', l.id, 'wantedId', w.id),
    'wanted-' || w.id || '-' || l.id
  );
end;
$$;
revoke all on function public.wanted_send_listing(bigint, bigint) from public, anon, authenticated;
grant execute on function public.wanted_send_listing(bigint, bigint) to authenticated;

-- When a listing goes live, tell everyone whose wanted ad it fits.
create or replace function public.listings_wanted_match()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  w public.wanted_ads;
  n integer := 0;
begin
  if new.status <> 'active' or (tg_op = 'UPDATE' and old.status = 'active') then
    return new;
  end if;
  for w in
    select * from public.wanted_ads
     where status = 'open' and expires_at > now() and category = new.category and member_id <> new.seller_id
     order by created_at
  loop
    exit when n >= 50;
    if public.wanted_fit(w, new) = 'fits' then
      perform public.notify_user(
        w.member_id,
        'wanted_match',
        'Just listed: one you''re looking for',
        left(new.title, 120) || ' · ' || coalesce(public.format_euro_cents(coalesce(new.price_cents, round(new.price_eur * 100)::integer)), 'auction')
          || coalesce(' · ' || new.county, '') || '.',
        jsonb_build_object('href', '/marketplace/' || new.id, 'listingId', new.id, 'wantedId', w.id),
        'wanted-' || w.id || '-' || new.id
      );
      n := n + 1;
    end if;
  end loop;
  return new;
exception when others then
  -- Matching must never stop a listing going live.
  return new;
end;
$$;
revoke all on function public.listings_wanted_match() from public, anon, authenticated;

drop trigger if exists listings_wanted_match on public.listings;
create trigger listings_wanted_match
  after insert or update of status on public.listings
  for each row execute function public.listings_wanted_match();
