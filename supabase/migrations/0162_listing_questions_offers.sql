-- 0162 — Public questions & offers on a listing (Oct 2026).
--
-- Like Adverts.ie: under every used-gear ad there's a public thread. Anyone
-- signed in (18+) can ask the seller a question or post an offer, and the
-- seller answers in the open — accept, decline or counter an offer, reply to
-- a question. Everyone sees the same thing: the asking price, the highest
-- open offer and how each offer went. Nothing here moves money; it's the cash
-- marketplace (0160). Phone numbers and collection details stay private in
-- Messages.
--
-- This is deliberately NOT public.offers. That table belongs to the Stripe
-- flow (reservations, expiry, checkout windows) that 0160 switched off, and
-- mixing the two would make "switch payments back on" a data migration.
--
-- Writes go only through the functions below (no insert/update/delete
-- policies), so the rules live in one place:
--   * only on a listing that's on sale (active or reserved), never your own
--     (except the seller replying), never with someone you've blocked or who
--     has blocked you;
--   * one open offer per buyer per listing — a new one replaces the old;
--   * a reply hangs under a question or an offer, and comes from the seller
--     or that post's author;
--   * members under 18 can read but not post (age_guard 'adult_only').
--
-- When a listing stops being on sale, its open offers close.
--
-- Rollback:
--   drop trigger if exists listings_close_public_offers on public.listings;
--   drop function if exists public.close_public_offers_on_listing_change();
--   drop function if exists public.listing_public_posts(bigint);
--   drop function if exists public.remove_listing_post(bigint);
--   drop function if exists public.withdraw_listing_offer(bigint);
--   drop function if exists public.answer_listing_offer(bigint, text, integer, text);
--   drop function if exists public.reply_to_listing_post(bigint, text);
--   drop function if exists public.post_listing_offer(bigint, integer, text);
--   drop function if exists public.post_listing_question(bigint, text);
--   drop table if exists public.listing_posts;

create table if not exists public.listing_posts (
  id bigint generated always as identity primary key,
  listing_id bigint not null references public.listings (id) on delete cascade,
  author_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('question', 'offer', 'reply')),
  parent_id bigint references public.listing_posts (id) on delete cascade,
  body text check (body is null or char_length(body) between 1 and 500),
  amount_cents integer check (amount_cents is null or amount_cents between 100 and 10000000),
  status text check (status is null or status in ('open', 'accepted', 'declined', 'countered', 'withdrawn', 'closed')),
  counter_cents integer check (counter_cents is null or counter_cents between 100 and 10000000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Moderation (service role) or the author taking it down.
  hidden_at timestamptz,
  constraint listing_posts_shape check (
    (kind = 'question' and parent_id is null and body is not null and amount_cents is null and status is null)
    or (kind = 'offer' and parent_id is null and amount_cents is not null and status is not null)
    or (kind = 'reply' and parent_id is not null and body is not null and amount_cents is null and status is null)
  )
);

create index if not exists listing_posts_listing_idx on public.listing_posts (listing_id, created_at);
create index if not exists listing_posts_author_idx on public.listing_posts (author_id);
create index if not exists listing_posts_parent_idx on public.listing_posts (parent_id);
-- One open offer per buyer per listing.
create unique index if not exists listing_posts_one_open_offer
  on public.listing_posts (listing_id, author_id)
  where kind = 'offer' and status = 'open';

drop trigger if exists listing_posts_set_updated_at on public.listing_posts;
create trigger listing_posts_set_updated_at
  before update on public.listing_posts
  for each row
  execute function public.set_updated_at();

alter table public.listing_posts enable row level security;

-- Reads go through listing_public_posts() (it adds names and clubs), but the
-- rows themselves are public in the same way the listing is.
drop policy if exists "Anyone reads the questions and offers on a visible listing" on public.listing_posts;
create policy "Anyone reads the questions and offers on a visible listing"
  on public.listing_posts for select
  to anon, authenticated
  using (
    hidden_at is null
    and exists (
      select 1 from public.listings l
      where l.id = listing_posts.listing_id
        and public.listing_is_visible_row(l.status, l.seller_id, l.id)
    )
  );

revoke insert, update, delete on public.listing_posts from anon, authenticated;

-- Under 18s browse only (0159). The functions below run as the definer, but
-- auth.uid() is still the member, so the guard still sees who's posting.
drop trigger if exists listing_posts_age_guard on public.listing_posts;
create trigger listing_posts_age_guard
  before insert on public.listing_posts
  for each row
  execute function public.age_guard('adult_only');


-- ============ Helpers ============

-- The listing, locked, if the caller may post on it. Raises otherwise.
create or replace function public.listing_for_public_post(p_listing_id bigint, p_me uuid)
returns public.listings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_listing public.listings;
begin
  if p_me is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  select * into v_listing from public.listings where id = p_listing_id for update;
  if not found or not public.listing_is_visible_row(v_listing.status, v_listing.seller_id, v_listing.id) then
    raise exception 'That listing couldn''t be found.' using errcode = 'P0002';
  end if;
  if v_listing.status not in ('active', 'reserved') then
    raise exception 'This listing isn''t on sale any more.' using errcode = '22023';
  end if;
  if v_listing.seller_id <> p_me and public.is_blocked(p_me, v_listing.seller_id) then
    raise exception 'You can''t post on this listing.' using errcode = '42501';
  end if;
  return v_listing;
end;
$$;

revoke all on function public.listing_for_public_post(bigint, uuid) from public, anon, authenticated;

create or replace function public.format_euro_cents(p_cents integer)
returns text
language sql
immutable
set search_path = public
as $$
  select '€' || case
    when p_cents % 100 = 0 then (p_cents / 100)::text
    else to_char(p_cents / 100.0, 'FM999999990.00')
  end;
$$;


-- ============ Writes ============

create or replace function public.post_listing_question(p_listing_id bigint, p_body text)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_listing public.listings;
  v_body text := nullif(trim(coalesce(p_body, '')), '');
  v_id bigint;
begin
  v_listing := public.listing_for_public_post(p_listing_id, v_me);
  if v_listing.seller_id = v_me then
    raise exception 'It''s your listing — add the answer to your description instead.' using errcode = '22023';
  end if;
  if v_body is null then
    raise exception 'Write your question first.' using errcode = '22023';
  end if;
  if (select count(*) from public.listing_posts
       where listing_id = p_listing_id and author_id = v_me and created_at > now() - interval '1 day') >= 10 then
    raise exception 'That''s plenty for today — message the seller instead.' using errcode = '22023';
  end if;

  insert into public.listing_posts (listing_id, author_id, kind, body)
  values (p_listing_id, v_me, 'question', left(v_body, 500))
  returning id into v_id;

  perform public.notify_user(
    v_listing.seller_id,
    'listing_question',
    public.marketplace_short_name(v_me) || ' asked about your ' || v_listing.title,
    left(v_body, 140),
    jsonb_build_object('href', '/marketplace/' || p_listing_id || '#questions', 'listingId', p_listing_id, 'postId', v_id),
    'listing-post-' || v_id
  );
  return v_id;
end;
$$;

revoke all on function public.post_listing_question(bigint, text) from public, anon, authenticated;
grant execute on function public.post_listing_question(bigint, text) to authenticated;

/** A public offer. Replaces the member's earlier open offer on this listing. */
create or replace function public.post_listing_offer(p_listing_id bigint, p_amount_cents integer, p_note text default null)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_listing public.listings;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
  v_id bigint;
begin
  v_listing := public.listing_for_public_post(p_listing_id, v_me);
  if v_listing.seller_id = v_me then
    raise exception 'You can''t make an offer on your own listing.' using errcode = '22023';
  end if;
  if p_amount_cents is null or p_amount_cents < 100 then
    raise exception 'Offers start at €1.' using errcode = '22023';
  end if;
  if p_amount_cents > 10000000 then
    raise exception 'That offer doesn''t look right.' using errcode = '22023';
  end if;
  if (select count(*) from public.listing_posts
       where listing_id = p_listing_id and author_id = v_me and kind = 'offer'
         and created_at > now() - interval '1 day') >= 5 then
    raise exception 'You''ve made a few offers today — message the seller instead.' using errcode = '22023';
  end if;

  update public.listing_posts
     set status = 'withdrawn'
   where listing_id = p_listing_id and author_id = v_me and kind = 'offer' and status = 'open';

  insert into public.listing_posts (listing_id, author_id, kind, body, amount_cents, status)
  values (p_listing_id, v_me, 'offer', left(v_note, 500), p_amount_cents, 'open')
  returning id into v_id;

  perform public.notify_user(
    v_listing.seller_id,
    'listing_offer',
    public.marketplace_short_name(v_me) || ' offered ' || public.format_euro_cents(p_amount_cents),
    'For your ' || v_listing.title || '. Accept, decline or counter it.',
    jsonb_build_object('href', '/marketplace/' || p_listing_id || '#questions', 'listingId', p_listing_id, 'postId', v_id),
    'listing-post-' || v_id
  );
  return v_id;
end;
$$;

revoke all on function public.post_listing_offer(bigint, integer, text) from public, anon, authenticated;
grant execute on function public.post_listing_offer(bigint, integer, text) to authenticated;

/** A reply under a question or an offer — from the seller, or that post's author. */
create or replace function public.reply_to_listing_post(p_post_id bigint, p_body text)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_parent public.listing_posts;
  v_listing public.listings;
  v_body text := nullif(trim(coalesce(p_body, '')), '');
  v_id bigint;
  v_to uuid;
begin
  select * into v_parent from public.listing_posts where id = p_post_id and hidden_at is null;
  if not found or v_parent.kind = 'reply' then
    raise exception 'That post couldn''t be found.' using errcode = 'P0002';
  end if;
  v_listing := public.listing_for_public_post(v_parent.listing_id, v_me);
  if v_me <> v_listing.seller_id and v_me <> v_parent.author_id then
    raise exception 'Only the seller and whoever asked can reply here.' using errcode = '42501';
  end if;
  if v_body is null then
    raise exception 'Write your reply first.' using errcode = '22023';
  end if;

  insert into public.listing_posts (listing_id, author_id, kind, parent_id, body)
  values (v_parent.listing_id, v_me, 'reply', p_post_id, left(v_body, 500))
  returning id into v_id;

  v_to := case when v_me = v_listing.seller_id then v_parent.author_id else v_listing.seller_id end;
  if v_to <> v_me then
    perform public.notify_user(
      v_to,
      'listing_reply',
      public.marketplace_short_name(v_me) || ' replied about the ' || v_listing.title,
      left(v_body, 140),
      jsonb_build_object('href', '/marketplace/' || v_listing.id || '#questions', 'listingId', v_listing.id, 'postId', v_id),
      'listing-post-' || v_id
    );
  end if;
  return v_id;
end;
$$;

revoke all on function public.reply_to_listing_post(bigint, text) from public, anon, authenticated;
grant execute on function public.reply_to_listing_post(bigint, text) to authenticated;

/**
 * The seller answers an open offer: accept, decline or counter (with an
 * amount). An optional note goes up as a reply underneath, in the open.
 * Accepting doesn't sell anything — they still meet, pay and mark it sold.
 */
create or replace function public.answer_listing_offer(
  p_post_id bigint,
  p_action text,
  p_counter_cents integer default null,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_offer public.listing_posts;
  v_listing public.listings;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
  v_title text;
begin
  select * into v_offer from public.listing_posts where id = p_post_id and kind = 'offer' and hidden_at is null for update;
  if not found then
    raise exception 'That offer couldn''t be found.' using errcode = 'P0002';
  end if;
  v_listing := public.listing_for_public_post(v_offer.listing_id, v_me);
  if v_listing.seller_id <> v_me then
    raise exception 'Only the seller can answer an offer.' using errcode = '42501';
  end if;
  if v_offer.status <> 'open' then
    raise exception 'That offer has already been answered.' using errcode = '22023';
  end if;
  if p_action not in ('accept', 'decline', 'counter') then
    raise exception 'Choose accept, decline or counter.' using errcode = '22023';
  end if;
  if p_action = 'counter' and (p_counter_cents is null or p_counter_cents < 100 or p_counter_cents > 10000000) then
    raise exception 'Say what you''d take.' using errcode = '22023';
  end if;
  if p_action = 'counter' and p_counter_cents <= v_offer.amount_cents then
    raise exception 'A counter offer is more than they offered — or accept theirs.' using errcode = '22023';
  end if;

  update public.listing_posts
     set status = case p_action when 'accept' then 'accepted' when 'decline' then 'declined' else 'countered' end,
         counter_cents = case when p_action = 'counter' then p_counter_cents end
   where id = p_post_id;

  if v_note is not null then
    insert into public.listing_posts (listing_id, author_id, kind, parent_id, body)
    values (v_offer.listing_id, v_me, 'reply', p_post_id, left(v_note, 500));
  end if;

  v_title := case p_action
    when 'accept' then public.marketplace_short_name(v_me) || ' accepted your ' || public.format_euro_cents(v_offer.amount_cents) || ' offer'
    when 'decline' then public.marketplace_short_name(v_me) || ' declined your ' || public.format_euro_cents(v_offer.amount_cents) || ' offer'
    else public.marketplace_short_name(v_me) || ' would take ' || public.format_euro_cents(p_counter_cents)
  end;

  perform public.notify_user(
    v_offer.author_id,
    'listing_offer_answered',
    v_title,
    case when p_action = 'accept' then 'Message them to arrange collection — the ' || v_listing.title || '.' else 'The ' || v_listing.title || '.' end,
    jsonb_build_object('href', '/marketplace/' || v_listing.id || '#questions', 'listingId', v_listing.id, 'postId', p_post_id),
    'listing-offer-' || p_post_id || '-' || p_action
  );
end;
$$;

revoke all on function public.answer_listing_offer(bigint, text, integer, text) from public, anon, authenticated;
grant execute on function public.answer_listing_offer(bigint, text, integer, text) to authenticated;

create or replace function public.withdraw_listing_offer(p_post_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  update public.listing_posts
     set status = 'withdrawn'
   where id = p_post_id and author_id = v_me and kind = 'offer' and status in ('open', 'countered');
  if not found then
    raise exception 'That offer couldn''t be found.' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.withdraw_listing_offer(bigint) from public, anon, authenticated;
grant execute on function public.withdraw_listing_offer(bigint) to authenticated;

/** Take down your own question or reply (an offer is withdrawn instead, so the history stays honest). */
create or replace function public.remove_listing_post(p_post_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  update public.listing_posts
     set hidden_at = now()
   where id = p_post_id and author_id = v_me and kind in ('question', 'reply') and hidden_at is null;
  if not found then
    raise exception 'That post couldn''t be found.' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.remove_listing_post(bigint) from public, anon, authenticated;
grant execute on function public.remove_listing_post(bigint) to authenticated;


-- ============ Read ============

/**
 * The thread, oldest first, with who wrote each post: first name and initial
 * (as on feedback), their club, and whether they're the seller. Readable by
 * anyone who can see the listing, signed in or not. Posts from members the
 * viewer has blocked (or who blocked them) are left out.
 */
create or replace function public.listing_public_posts(p_listing_id bigint)
returns table (
  id bigint,
  kind text,
  parent_id bigint,
  author_name text,
  author_initials text,
  author_color text,
  author_club text,
  is_seller boolean,
  is_mine boolean,
  body text,
  amount_cents integer,
  status text,
  counter_cents integer,
  created_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select
    p.id,
    p.kind,
    p.parent_id,
    public.marketplace_short_name(p.author_id),
    upper(left(coalesce(pr.first_name, '?'), 1) || left(coalesce(pr.last_name, ''), 1)),
    coalesce(pr.avatar_color, '#123058'),
    pr.home_club,
    p.author_id = l.seller_id,
    p.author_id = auth.uid(),
    p.body,
    p.amount_cents,
    p.status,
    p.counter_cents,
    p.created_at
  from public.listing_posts p
  join public.listings l on l.id = p.listing_id
  left join public.profiles pr on pr.id = p.author_id
  where p.listing_id = p_listing_id
    and p.hidden_at is null
    and public.listing_is_visible_row(l.status, l.seller_id, l.id)
    and (auth.uid() is null or p.author_id = auth.uid() or not public.is_blocked(auth.uid(), p.author_id))
  order by p.created_at, p.id
  limit 300;
$$;

revoke all on function public.listing_public_posts(bigint) from public, anon, authenticated;
grant execute on function public.listing_public_posts(bigint) to anon, authenticated;


-- ============ When a listing stops being on sale ============

create or replace function public.close_public_offers_on_listing_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status not in ('active', 'reserved') and old.status in ('active', 'reserved') then
    update public.listing_posts
       set status = 'closed'
     where listing_id = new.id and kind = 'offer' and status in ('open', 'countered');
  end if;
  return new;
end;
$$;

revoke all on function public.close_public_offers_on_listing_change() from public, anon, authenticated;

drop trigger if exists listings_close_public_offers on public.listings;
create trigger listings_close_public_offers
  after update of status on public.listings
  for each row
  execute function public.close_public_offers_on_listing_change();
