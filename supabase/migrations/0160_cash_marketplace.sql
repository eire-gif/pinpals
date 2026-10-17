-- 0160_cash_marketplace.sql — the used marketplace without payments (Oct 2026).
--
-- PinPals stops handling money for used gear. Like Adverts or DoneDeal, it
-- introduces buyer and seller; they meet (usually at the club) and pay each
-- other in cash or by Revolut. What PinPals keeps is the part only it can do:
-- trust. A seller marks the item sold and picks who bought it from the people
-- they messaged, and the two leave each other feedback — thumbs up or down,
-- a few tags, an optional comment — which shows in the marketplace only,
-- never on the member's golf profile.
--
-- THE SWITCH
--
--   marketplace_settings.payments_enabled (one row, default OFF). Off: no
--   Buy now / Buyer Protection / Stripe anywhere, listings go on sale without
--   Stripe payouts, offers are a message. On: everything from 0114 as before.
--   Nothing Stripe-shaped is dropped — orders, offers, payouts and reviews
--   all stay, so switching it back on is a row update, not a migration.
--
-- WHAT THIS ADDS
--
--   1. marketplace_settings + marketplace_payments_enabled().
--   2. Messaging a seller about a listing. Until now can_message() only let
--      connected members, offer parties and tee-time partners talk, which
--      made "Message the seller" fail for a stranger — fine when buying ran
--      through checkout, fatal when the conversation IS the sale. A
--      conversation tied to an on-sale listing may now be started with its
--      seller by anyone not blocked (age_guard still applies to juniors).
--   3. marketplace_sales — one row per listing marked sold: which member
--      bought it (or "sold somewhere else"), an optional private final price
--      for the price guide. Written only by mark_listing_sold().
--   4. marketplace_feedback — one per side per sale. Hidden from everyone but
--      its author until the other side has left theirs or 7 days pass, so
--      nobody writes theirs in reply to the other's. Open for 30 days.
--      Written only by leave_marketplace_feedback().
--   5. Reads: marketplace_possible_buyers(), marketplace_sale_summary(),
--      marketplace_member_stats(), marketplace_member_feedback().
--   6. listing_is_visible_row() also lets the buyer of a sold listing see it,
--      so their feedback screen can show what they bought.
--
-- Rollback:
--   drop function if exists public.marketplace_member_feedback(uuid, integer, bigint);
--   drop function if exists public.marketplace_member_stats(uuid);
--   drop function if exists public.marketplace_sale_summary(bigint);
--   drop function if exists public.decline_marketplace_sale(bigint);
--   drop function if exists public.leave_marketplace_feedback(bigint, boolean, text[], text);
--   drop function if exists public.marketplace_possible_buyers(bigint);
--   drop function if exists public.mark_listing_sold(bigint, uuid, integer);
--   drop function if exists public.marketplace_feedback_revealed(bigint);
--   drop table if exists public.marketplace_feedback;
--   drop table if exists public.marketplace_sales;
--   -- restore 0087's "Members start eligible conversations" and 0052's listing_is_visible_row()
--   drop function if exists public.can_message_about_listing(uuid, uuid, bigint);
--   drop function if exists public.marketplace_payments_enabled();
--   drop table if exists public.marketplace_settings;


-- ============ 1. The switch ============

create table if not exists public.marketplace_settings (
  id boolean primary key default true check (id),
  payments_enabled boolean not null default false,
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);

insert into public.marketplace_settings (id) values (true) on conflict (id) do nothing;

comment on table public.marketplace_settings is
  'Marketplace master switches (0160). One row. payments_enabled off = cash/Revolut between members, no checkout.';

alter table public.marketplace_settings enable row level security;

-- Public: the app and the website both decide what to draw from it, signed in or not.
drop policy if exists "Anyone reads the marketplace settings" on public.marketplace_settings;
create policy "Anyone reads the marketplace settings"
  on public.marketplace_settings for select
  to anon, authenticated
  using (true);

-- Changed by staff through the admin console's service-role client only.
revoke insert, update, delete, truncate, references, trigger on public.marketplace_settings from anon, authenticated;

create or replace function public.marketplace_payments_enabled()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce((select payments_enabled from public.marketplace_settings where id), false);
$$;

revoke all on function public.marketplace_payments_enabled() from public;
grant execute on function public.marketplace_payments_enabled() to anon, authenticated;


-- ============ 2. Messaging a seller about their listing ============

create or replace function public.can_message_about_listing(a uuid, b uuid, p_listing_id bigint)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select
    a is not null
    and b is not null
    and a <> b
    and not public.is_blocked(a, b)
    and exists (
      select 1 from public.listings l
      where l.id = p_listing_id
        and l.status in ('active', 'reserved')
        and (l.seller_id = a or l.seller_id = b)
    );
$$;

revoke all on function public.can_message_about_listing(uuid, uuid, bigint) from public, anon;
grant execute on function public.can_message_about_listing(uuid, uuid, bigint) to authenticated;

-- 0087's policy with one more way in. Still direct threads only, still a
-- party to it, still nobody blocked.
drop policy if exists "Members start eligible conversations" on public.conversations;
create policy "Members start eligible conversations"
  on public.conversations for insert
  to authenticated
  with check (
    kind = 'direct'
    and (user_a_id = (select auth.uid()) or user_b_id = (select auth.uid()))
    and (
      public.can_message(user_a_id, user_b_id)
      or (listing_id is not null and public.can_message_about_listing(user_a_id, user_b_id, listing_id))
    )
  );


-- ============ 3. Sales ============

create table if not exists public.marketplace_sales (
  id bigint generated always as identity primary key,
  listing_id bigint not null unique references public.listings (id) on delete cascade,
  seller_id uuid not null references public.profiles (id) on delete cascade,
  buyer_id uuid references public.profiles (id) on delete set null,
  sold_elsewhere boolean not null default false,
  -- Private to the two of them and staff; feeds the price guide as an aggregate.
  final_price_cents integer check (final_price_cents is null or final_price_cents between 0 and 10000000),
  -- The picked buyer said "that wasn't me": no feedback either way.
  buyer_declined_at timestamptz,
  created_at timestamptz not null default now(),
  constraint marketplace_sales_not_self check (buyer_id is null or buyer_id <> seller_id),
  constraint marketplace_sales_elsewhere_has_no_buyer check (not (sold_elsewhere and buyer_id is not null))
);

create index if not exists marketplace_sales_seller_idx on public.marketplace_sales (seller_id, created_at desc);
create index if not exists marketplace_sales_buyer_idx on public.marketplace_sales (buyer_id, created_at desc);

alter table public.marketplace_sales enable row level security;

drop policy if exists "Sellers and buyers read their own sales" on public.marketplace_sales;
create policy "Sellers and buyers read their own sales"
  on public.marketplace_sales for select
  to authenticated
  using (seller_id = (select auth.uid()) or buyer_id = (select auth.uid()) or public.is_staff());

revoke all on public.marketplace_sales from anon;
revoke insert, update, delete, truncate, references, trigger on public.marketplace_sales from authenticated;


-- ============ 4. Feedback ============

create table if not exists public.marketplace_feedback (
  id bigint generated always as identity primary key,
  sale_id bigint not null references public.marketplace_sales (id) on delete cascade,
  reviewer_id uuid not null references public.profiles (id) on delete cascade,
  reviewee_id uuid not null references public.profiles (id) on delete cascade,
  -- What the person being reviewed was in this sale.
  reviewee_role text not null check (reviewee_role in ('seller', 'buyer')),
  positive boolean not null,
  tags text[] not null default '{}' check (
    cardinality(tags) <= 6
    and tags <@ array['as_described', 'quick_reply', 'fair_price', 'on_time', 'friendly', 'well_packed', 'paid_promptly', 'easy_to_deal']::text[]
  ),
  body text check (body is null or char_length(body) between 1 and 500),
  hidden_at timestamptz,
  hidden_by uuid references public.profiles (id) on delete set null,
  hidden_reason text check (char_length(hidden_reason) <= 2000),
  created_at timestamptz not null default now(),
  constraint marketplace_feedback_not_self check (reviewer_id <> reviewee_id),
  unique (sale_id, reviewer_id)
);

create index if not exists marketplace_feedback_reviewee_idx on public.marketplace_feedback (reviewee_id, created_at desc);

alter table public.marketplace_feedback enable row level security;

-- Your own feedback, always; everyone else's through marketplace_member_feedback(),
-- which only returns what has been revealed and not hidden by staff.
drop policy if exists "Reviewers read their own feedback" on public.marketplace_feedback;
create policy "Reviewers read their own feedback"
  on public.marketplace_feedback for select
  to authenticated
  using (reviewer_id = (select auth.uid()) or public.is_staff());

revoke all on public.marketplace_feedback from anon;
revoke insert, update, delete, truncate, references, trigger on public.marketplace_feedback from authenticated;

-- Both sides have spoken, or a week has passed since the sale.
create or replace function public.marketplace_feedback_revealed(p_sale_id bigint)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select
    (select count(*) from public.marketplace_feedback f where f.sale_id = p_sale_id) >= 2
    or exists (
      select 1 from public.marketplace_sales s
      where s.id = p_sale_id and s.created_at < now() - interval '7 days'
    );
$$;

revoke all on function public.marketplace_feedback_revealed(bigint) from public, anon, authenticated;


-- ============ 6. A buyer can see what they bought ============
-- 0052's body with the marketplace_sales branch added.
create or replace function public.listing_is_visible_row(
  target_status text,
  target_seller_id uuid,
  target_listing_id bigint
)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select
    target_status = 'active'
    or target_seller_id = auth.uid()
    or public.is_staff()
    or exists (
      select 1 from public.offers o
      where o.listing_id = target_listing_id and o.buyer_id = auth.uid()
    )
    or exists (
      select 1 from public.orders ord
      where ord.listing_id = target_listing_id
        and (ord.buyer_id = auth.uid() or ord.seller_id = auth.uid())
    )
    or exists (
      select 1 from public.marketplace_sales s
      where s.listing_id = target_listing_id and s.buyer_id = auth.uid()
    );
$$;


-- ============ Writes ============

-- How a member's name shows on feedback: first name and an initial.
create or replace function public.marketplace_short_name(p_member uuid)
returns text
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(
    nullif(trim(concat_ws(' ', p.first_name, case when nullif(trim(p.last_name), '') is not null then left(trim(p.last_name), 1) || '.' end)), ''),
    'A member'
  )
  from public.profiles p
  where p.id = p_member;
$$;

revoke all on function public.marketplace_short_name(uuid) from public, anon, authenticated;

/**
 * The seller marks their listing sold and, if it went to someone on PinPals,
 * names them. The buyer has to be somebody the seller has a direct thread
 * with — they agreed it in chat — which stops a seller naming a stranger to
 * collect feedback from.
 */
create or replace function public.mark_listing_sold(
  p_listing_id bigint,
  p_buyer_id uuid default null,
  p_final_price_cents integer default null
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_listing record;
  v_sale_id bigint;
begin
  if v_me is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;

  select id, seller_id, status, title into v_listing
    from public.listings where id = p_listing_id for update;

  if not found or v_listing.seller_id <> v_me then
    raise exception 'That listing couldn''t be found.' using errcode = 'P0002';
  end if;
  if v_listing.status not in ('active', 'reserved') then
    raise exception 'Only a listing that''s on sale can be marked sold.' using errcode = '22023';
  end if;
  if p_final_price_cents is not null and (p_final_price_cents < 0 or p_final_price_cents > 10000000) then
    raise exception 'That price doesn''t look right.' using errcode = '22023';
  end if;

  if p_buyer_id is not null then
    if p_buyer_id = v_me then
      raise exception 'You can''t buy your own listing.' using errcode = '22023';
    end if;
    if public.is_blocked(v_me, p_buyer_id) or not exists (
      select 1 from public.conversations c
      where c.kind = 'direct'
        and least(c.user_a_id, c.user_b_id) = least(v_me, p_buyer_id)
        and greatest(c.user_a_id, c.user_b_id) = greatest(v_me, p_buyer_id)
    ) then
      raise exception 'Pick someone you''ve messaged on PinPals.' using errcode = '22023';
    end if;
  end if;

  -- The seller's own transition: active/reserved -> sold is one the 0045
  -- trigger allows a member, and it closes any open offers as before.
  update public.listings set status = 'sold' where id = p_listing_id;

  insert into public.marketplace_sales (listing_id, seller_id, buyer_id, sold_elsewhere, final_price_cents)
  values (p_listing_id, v_me, p_buyer_id, p_buyer_id is null, p_final_price_cents)
  returning id into v_sale_id;

  if p_buyer_id is not null then
    perform public.notify_user(
      p_buyer_id,
      'marketplace_feedback_due',
      'How did it go with ' || public.marketplace_short_name(v_me) || '?',
      'You bought ' || v_listing.title || '. Leave feedback for the seller.',
      jsonb_build_object('href', '/marketplace/feedback/' || v_sale_id, 'saleId', v_sale_id, 'listingId', p_listing_id),
      'marketplace-sale-' || v_sale_id || '-buyer'
    );
  end if;

  return v_sale_id;
end;
$$;

revoke all on function public.mark_listing_sold(bigint, uuid, integer) from public, anon;
grant execute on function public.mark_listing_sold(bigint, uuid, integer) to authenticated;

/**
 * One side's feedback. Open to the seller and the named buyer for 30 days.
 */
create or replace function public.leave_marketplace_feedback(
  p_sale_id bigint,
  p_positive boolean,
  p_tags text[] default '{}',
  p_body text default null
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_sale public.marketplace_sales%rowtype;
  v_other uuid;
  v_role text;
  v_id bigint;
  v_body text := nullif(trim(coalesce(p_body, '')), '');
  v_tags text[];
  v_title text;
begin
  if v_me is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  if p_positive is null then
    raise exception 'Choose Good or Not good.' using errcode = '22023';
  end if;

  select * into v_sale from public.marketplace_sales where id = p_sale_id;
  if not found or (v_me <> v_sale.seller_id and v_me is distinct from v_sale.buyer_id) then
    raise exception 'That sale couldn''t be found.' using errcode = 'P0002';
  end if;
  if v_sale.buyer_id is null or v_sale.buyer_declined_at is not null then
    raise exception 'Feedback isn''t open for this sale.' using errcode = '22023';
  end if;
  if v_sale.created_at < now() - interval '30 days' then
    raise exception 'Feedback closes 30 days after the sale.' using errcode = '22023';
  end if;

  if v_me = v_sale.seller_id then
    v_other := v_sale.buyer_id;
    v_role := 'buyer';
  else
    v_other := v_sale.seller_id;
    v_role := 'seller';
  end if;

  select coalesce(array_agg(distinct t), '{}') into v_tags from unnest(coalesce(p_tags, '{}')) t;

  begin
    insert into public.marketplace_feedback (sale_id, reviewer_id, reviewee_id, reviewee_role, positive, tags, body)
    values (p_sale_id, v_me, v_other, v_role, p_positive, v_tags, left(v_body, 500))
    returning id into v_id;
  exception when unique_violation then
    raise exception 'You''ve already left feedback for this sale.' using errcode = '23505';
  end;

  select title into v_title from public.listings where id = v_sale.listing_id;

  if (select count(*) from public.marketplace_feedback where sale_id = p_sale_id) = 1 then
    perform public.notify_user(
      v_other,
      'marketplace_feedback_received',
      public.marketplace_short_name(v_me) || ' left you feedback',
      'Leave yours for ' || coalesce(v_title, 'the sale') || ' and you''ll both see it.',
      jsonb_build_object('href', '/marketplace/feedback/' || p_sale_id, 'saleId', p_sale_id, 'listingId', v_sale.listing_id),
      'marketplace-feedback-' || p_sale_id || '-' || v_other
    );
  end if;

  return v_id;
end;
$$;

revoke all on function public.leave_marketplace_feedback(bigint, boolean, text[], text) from public, anon;
grant execute on function public.leave_marketplace_feedback(bigint, boolean, text[], text) to authenticated;

/** The named buyer says they didn't buy it: the sale stays sold, feedback closes and any left is withdrawn. */
create or replace function public.decline_marketplace_sale(p_sale_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
begin
  update public.marketplace_sales
     set buyer_declined_at = now()
   where id = p_sale_id and buyer_id = v_me and buyer_declined_at is null;
  if not found then
    raise exception 'That sale couldn''t be found.' using errcode = 'P0002';
  end if;
  delete from public.marketplace_feedback where sale_id = p_sale_id;
end;
$$;

revoke all on function public.decline_marketplace_sale(bigint) from public, anon;
grant execute on function public.decline_marketplace_sale(bigint) to authenticated;


-- ============ Reads ============

/** Who the seller could have sold to: the people they have direct threads with, this listing's first. */
create or replace function public.marketplace_possible_buyers(p_listing_id bigint)
returns table (
  member_id uuid,
  name text,
  avatar_url text,
  avatar_color text,
  last_message_at timestamptz,
  about_listing boolean
)
language sql
security definer
set search_path = public
stable
as $$
  with me as (
    select auth.uid() as id
  ), threads as (
    select
      case when c.user_a_id = me.id then c.user_b_id else c.user_a_id end as other_id,
      max(c.last_message_at) as last_at,
      bool_or(c.listing_id = p_listing_id) as about
    from public.conversations c, me
    where c.kind = 'direct'
      and (c.user_a_id = me.id or c.user_b_id = me.id)
      and exists (select 1 from public.listings l where l.id = p_listing_id and l.seller_id = me.id)
    group by 1
  )
  select
    t.other_id,
    trim(concat_ws(' ', p.first_name, p.last_name)),
    p.avatar_url,
    p.avatar_color,
    t.last_at,
    coalesce(t.about, false)
  from threads t
  join public.profiles p on p.id = t.other_id
  where t.other_id is not null
    and not public.is_blocked((select id from me), t.other_id)
  order by coalesce(t.about, false) desc, t.last_at desc nulls last
  limit 25;
$$;

revoke all on function public.marketplace_possible_buyers(bigint) from public, anon;
grant execute on function public.marketplace_possible_buyers(bigint) to authenticated;

/** Everything the feedback screen needs, for either party. */
create or replace function public.marketplace_sale_summary(p_sale_id bigint)
returns table (
  sale_id bigint,
  listing_id bigint,
  title text,
  image_url text,
  my_role text,
  other_id uuid,
  other_name text,
  other_avatar_url text,
  other_avatar_color text,
  sold_at timestamptz,
  closes_at timestamptz,
  declined boolean,
  i_left boolean,
  they_left boolean
)
language sql
security definer
set search_path = public
stable
as $$
  select
    s.id,
    s.listing_id,
    l.title,
    l.image_url,
    case when s.seller_id = auth.uid() then 'seller' else 'buyer' end,
    o.id,
    trim(concat_ws(' ', o.first_name, o.last_name)),
    o.avatar_url,
    o.avatar_color,
    s.created_at,
    s.created_at + interval '30 days',
    s.buyer_declined_at is not null,
    exists (select 1 from public.marketplace_feedback f where f.sale_id = s.id and f.reviewer_id = auth.uid()),
    exists (select 1 from public.marketplace_feedback f where f.sale_id = s.id and f.reviewer_id <> auth.uid())
  from public.marketplace_sales s
  join public.listings l on l.id = s.listing_id
  left join public.profiles o on o.id = case when s.seller_id = auth.uid() then s.buyer_id else s.seller_id end
  where s.id = p_sale_id
    and auth.uid() is not null
    and (s.seller_id = auth.uid() or s.buyer_id = auth.uid());
$$;

revoke all on function public.marketplace_sale_summary(bigint) from public, anon;
grant execute on function public.marketplace_sale_summary(bigint) to authenticated;

/** A member's marketplace record: revealed, visible feedback only. */
create or replace function public.marketplace_member_stats(p_member uuid)
returns table (
  positive integer,
  negative integer,
  sales integer,
  tag_counts jsonb
)
language sql
security definer
set search_path = public
stable
as $$
  with visible as (
    select f.positive, f.tags
    from public.marketplace_feedback f
    where f.reviewee_id = p_member
      and f.hidden_at is null
      and public.marketplace_feedback_revealed(f.sale_id)
  )
  select
    (select count(*) from visible where positive)::integer,
    (select count(*) from visible where not positive)::integer,
    ((select count(*) from public.marketplace_sales s where s.seller_id = p_member)
      + (select count(*) from public.orders o where o.seller_id = p_member and o.status = 'completed'))::integer,
    coalesce((
      select jsonb_object_agg(tag, n)
      from (
        select t as tag, count(*) as n
        from visible v, unnest(v.tags) t
        where v.positive
        group by t
      ) counted
    ), '{}'::jsonb);
$$;

revoke all on function public.marketplace_member_stats(uuid) from public;
grant execute on function public.marketplace_member_stats(uuid) to anon, authenticated;

/** A member's revealed feedback, newest first, a page at a time. */
create or replace function public.marketplace_member_feedback(
  p_member uuid,
  p_limit integer default 20,
  p_before_id bigint default null
)
returns table (
  id bigint,
  positive boolean,
  tags text[],
  body text,
  created_at timestamptz,
  reviewee_role text,
  reviewer_name text,
  reviewer_avatar_url text,
  reviewer_avatar_color text,
  item_title text
)
language sql
security definer
set search_path = public
stable
as $$
  select
    f.id,
    f.positive,
    f.tags,
    f.body,
    f.created_at,
    f.reviewee_role,
    public.marketplace_short_name(f.reviewer_id),
    p.avatar_url,
    p.avatar_color,
    l.title
  from public.marketplace_feedback f
  join public.marketplace_sales s on s.id = f.sale_id
  join public.listings l on l.id = s.listing_id
  join public.profiles p on p.id = f.reviewer_id
  where f.reviewee_id = p_member
    and f.hidden_at is null
    and public.marketplace_feedback_revealed(f.sale_id)
    and (p_before_id is null or f.id < p_before_id)
  order by f.id desc
  limit least(greatest(coalesce(p_limit, 20), 1), 50);
$$;

revoke all on function public.marketplace_member_feedback(uuid, integer, bigint) from public;
grant execute on function public.marketplace_member_feedback(uuid, integer, bigint) to anon, authenticated;
