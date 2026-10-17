-- 0164 — The catalogue learns from sellers (Oct 2026)
--
-- When a seller's item isn't in the catalogue they type it themselves: a
-- model ("Qi4D Tour") behind a known brand, or a brand behind "Other". Their
-- own ad uses what they typed straight away. Each one is also counted here,
-- once per seller, however it's spelled (case, spaces and punctuation are
-- ignored):
--
--   * 3 different sellers → the next seller is offered it as a "suggested"
--     choice (marketplace_member_suggestions);
--   * 5 different sellers → it joins the catalogue by itself: a model in
--     marketplace_models (learned), or a brand in marketplace_brands
--     (learned, with the categories it's sold under). The ads that used it
--     move under it, so buyers find them in the finder.
--
-- No approval step (the owner's call). Staff can hide anything learned in
-- Admin → Brands & models → Learned from members; a hidden one is recorded
-- in marketplace_catalogue_decisions and never learned again.
--
-- Rollback:
--   drop trigger if exists listings_catalogue_vote on public.listings;
--   drop function if exists public.listings_catalogue_vote();
--   drop function if exists public.marketplace_learn(text, text, text, text);
--   drop function if exists public.marketplace_member_suggestions(text, text);
--   drop function if exists public.marketplace_slug(text);
--   drop function if exists public.marketplace_norm(text);
--   drop table if exists public.marketplace_catalogue_decisions, public.marketplace_catalogue_votes;
--   alter table public.marketplace_brands drop column if exists categories, drop column if exists learned;
--   alter table public.marketplace_models drop column if exists learned;

-- The matching key: lower case, letters and digits only. "Qi 4D-Tour" and
-- "qi4d tour" are the same thing. Mirrored by normKey() in src/lib/sell-flow.ts.
create or replace function public.marketplace_norm(p_text text)
returns text
language sql
immutable
set search_path = public
as $$
  select nullif(regexp_replace(lower(coalesce(p_text, '')), '[^a-z0-9]', '', 'g'), '')
$$;

-- "Qi4D Tour" → "qi4d-tour", for ids.
create or replace function public.marketplace_slug(p_text text)
returns text
language sql
immutable
set search_path = public
as $$
  select nullif(btrim(regexp_replace(lower(coalesce(p_text, '')), '[^a-z0-9]+', '-', 'g'), '-'), '')
$$;

-- ============ learned brands and models ============

alter table public.marketplace_brands
  add column if not exists categories text[],
  add column if not exists learned boolean not null default false;

alter table public.marketplace_models
  add column if not exists learned boolean not null default false;

comment on column public.marketplace_models.learned is 'Added by itself once 5 sellers typed it (0164). Staff can hide it in Admin → Brands & models.';

comment on column public.marketplace_brands.categories is 'For a brand learned from sellers (0164): the categories it''s offered under. Curated brands keep theirs in src/data/golf-brands.json.';

-- ============ votes ============

create table if not exists public.marketplace_catalogue_votes (
  kind text not null check (kind in ('brand', 'model')),
  -- The known brand a model is for; '' for a brand vote.
  brand_id text not null default '',
  category text not null,
  norm_key text not null check (char_length(norm_key) between 1 and 80),
  label text not null check (char_length(label) between 1 and 80),
  user_id uuid not null references public.profiles (id) on delete cascade,
  listing_id bigint references public.listings (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (kind, brand_id, category, norm_key, user_id)
);

create index if not exists marketplace_catalogue_votes_key_idx
  on public.marketplace_catalogue_votes (kind, brand_id, category, norm_key);

comment on table public.marketplace_catalogue_votes is 'What sellers typed when their brand or model wasn''t listed (0164). One row per seller per thing. Written by the listings_catalogue_vote trigger only.';

alter table public.marketplace_catalogue_votes enable row level security;
revoke all on public.marketplace_catalogue_votes from anon, authenticated;

-- ============ decisions ============

create table if not exists public.marketplace_catalogue_decisions (
  kind text not null check (kind in ('brand', 'model')),
  brand_id text not null default '',
  category text not null,
  norm_key text not null,
  -- 'added' by itself at 5 sellers; 'dismissed' when staff hide it.
  decision text not null check (decision in ('added', 'dismissed')),
  -- The model or brand it became.
  target_id text,
  decided_by uuid references public.profiles (id) on delete set null,
  decided_at timestamptz not null default now(),
  primary key (kind, brand_id, category, norm_key)
);

comment on table public.marketplace_catalogue_decisions is 'What happened to things sellers typed (0164): learned automatically, or hidden by staff. Written by marketplace_learn() and Admin → Brands & models.';

alter table public.marketplace_catalogue_decisions enable row level security;
revoke all on public.marketplace_catalogue_decisions from anon, authenticated;

-- ============ learning ============
-- Called after each vote. At 5 different sellers, and unless staff have
-- hidden it, adds the brand or model and moves the ads that used it.

create or replace function public.marketplace_learn(p_kind text, p_brand text, p_category text, p_key text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sellers integer;
  v_label text;
  v_id text;
  v_n integer := 1;
  v_learned boolean;
begin
  if exists (select 1 from public.marketplace_catalogue_decisions d
              where d.kind = p_kind and d.brand_id = p_brand and d.category = p_category and d.norm_key = p_key) then
    return;
  end if;

  select count(distinct v.user_id) into v_sellers
    from public.marketplace_catalogue_votes v
   where v.kind = p_kind and v.brand_id = p_brand and v.category = p_category and v.norm_key = p_key;
  if v_sellers < 5 then
    return;
  end if;

  -- The spelling most sellers used, preferring one with capitals in it.
  select v.label into v_label
    from public.marketplace_catalogue_votes v
   where v.kind = p_kind and v.brand_id = p_brand and v.category = p_category and v.norm_key = p_key
   group by v.label
   order by (v.label <> lower(v.label)) desc, count(*) desc, v.label
   limit 1;
  if v_label = lower(v_label) then
    v_label := initcap(v_label);
  end if;

  if p_kind = 'model' then
    if exists (select 1 from public.marketplace_models m
                where m.brand_id = p_brand and m.category = p_category and public.marketplace_norm(m.family) = p_key) then
      return;
    end if;
    v_id := p_brand || '-' || coalesce(public.marketplace_slug(v_label), p_key);
    while exists (select 1 from public.marketplace_models where id = v_id) loop
      v_n := v_n + 1;
      v_id := p_brand || '-' || coalesce(public.marketplace_slug(v_label), p_key) || '-' || v_n;
    end loop;
    insert into public.marketplace_models (id, brand_id, category, family, learned)
    values (v_id, p_brand, p_category, left(v_label, 60), true);
    update public.listings l
       set model_id = v_id
     where l.brand = p_brand and l.category = p_category and l.model_id is null
       and public.marketplace_norm(l.model) = p_key;
  else
    -- A brand we already have under that name: a curated one means there's
    -- nothing to learn; a learned one just gains this category.
    select b.id, b.learned into v_id, v_learned
      from public.marketplace_brands b
     where public.marketplace_norm(b.label) = p_key
     order by b.learned
     limit 1;
    if v_id is not null and not v_learned then
      return;
    elsif v_id is not null then
      update public.marketplace_brands
         set categories = array(select distinct unnest(coalesce(categories, '{}') || array[p_category]))
       where id = v_id;
    else
      v_id := coalesce(public.marketplace_slug(v_label), p_key);
      while exists (select 1 from public.marketplace_brands where id = v_id) loop
        v_n := v_n + 1;
        v_id := coalesce(public.marketplace_slug(v_label), p_key) || '-' || v_n;
      end loop;
      insert into public.marketplace_brands (id, label, learned, categories)
      values (v_id, left(v_label, 60), true, array[p_category]);
    end if;
    update public.listings l
       set brand = v_id, brand_other = null
     where l.brand = 'other' and l.category = p_category
       and public.marketplace_norm(l.brand_other) = p_key;
  end if;

  insert into public.marketplace_catalogue_decisions (kind, brand_id, category, norm_key, decision, target_id)
  values (p_kind, p_brand, p_category, p_key, 'added', v_id)
  on conflict do nothing;
end;
$$;

revoke all on function public.marketplace_learn(text, text, text, text) from public, anon, authenticated;

-- ============ counting what sellers type ============
-- After a listing is saved: a typed model behind a known brand (no catalogue
-- model picked), or a typed brand behind "Other". SECURITY DEFINER because
-- the votes table takes no member writes.

create or replace function public.listings_catalogue_vote()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text;
begin
  if new.seller_id is null then
    return new;
  end if;

  if new.brand = 'other' and new.brand_other is not null then
    v_key := public.marketplace_norm(new.brand_other);
    if v_key is not null and char_length(v_key) between 2 and 80 then
      insert into public.marketplace_catalogue_votes (kind, brand_id, category, norm_key, label, user_id, listing_id)
      values ('brand', '', new.category, v_key, left(btrim(new.brand_other), 80), new.seller_id, new.id)
      on conflict (kind, brand_id, category, norm_key, user_id)
        do update set label = excluded.label, listing_id = excluded.listing_id, updated_at = now();
      perform public.marketplace_learn('brand', '', new.category, v_key);
    end if;
  elsif new.brand is not null and new.brand not in ('other', 'unknown', 'mixed')
        and new.model_id is null and new.model is not null then
    v_key := public.marketplace_norm(new.model);
    if v_key is not null and char_length(v_key) between 2 and 80 then
      insert into public.marketplace_catalogue_votes (kind, brand_id, category, norm_key, label, user_id, listing_id)
      values ('model', new.brand, new.category, v_key, left(btrim(new.model), 80), new.seller_id, new.id)
      on conflict (kind, brand_id, category, norm_key, user_id)
        do update set label = excluded.label, listing_id = excluded.listing_id, updated_at = now();
      perform public.marketplace_learn('model', new.brand, new.category, v_key);
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.listings_catalogue_vote() from public, anon, authenticated;

drop trigger if exists listings_catalogue_vote on public.listings;
create trigger listings_catalogue_vote
  after insert or update of brand, brand_other, model, model_id, category on public.listings
  for each row execute function public.listings_catalogue_vote();

-- ============ what the next seller is offered ============
-- p_brand null: brands sellers have typed for this category. p_brand set:
-- models sellers have typed for that brand in this category. Only things 3
-- or more different sellers typed, not yet decided, and not already in the
-- catalogue (at 5 it's learned, and so drops out of here). Returns the most common spelling and how many sellers — never
-- who. SECURITY DEFINER because the votes table is closed to members.

create or replace function public.marketplace_member_suggestions(p_category text, p_brand text default null)
returns table (label text, sellers integer)
language sql
stable
security definer
set search_path = public
as $$
  with keyed as (
    select v.norm_key, mode() within group (order by v.label) as label, count(distinct v.user_id)::integer as sellers
      from public.marketplace_catalogue_votes v
     where v.category = p_category
       and v.kind = case when p_brand is null then 'brand' else 'model' end
       and v.brand_id = coalesce(p_brand, '')
     group by v.norm_key
  )
  select k.label, k.sellers
    from keyed k
   where k.sellers >= 3
     and not exists (
       select 1 from public.marketplace_catalogue_decisions d
        where d.kind = case when p_brand is null then 'brand' else 'model' end
          and d.brand_id = coalesce(p_brand, '') and d.category = p_category and d.norm_key = k.norm_key
     )
     and (
       (p_brand is null and not exists (
          select 1 from public.marketplace_brands b where public.marketplace_norm(b.label) = k.norm_key or b.id = k.norm_key))
       or (p_brand is not null and not exists (
          select 1 from public.marketplace_models m
           where m.brand_id = p_brand and m.category = p_category and public.marketplace_norm(m.family) = k.norm_key))
     )
   order by k.sellers desc, k.label
   limit 12
$$;

revoke all on function public.marketplace_member_suggestions(text, text) from public;
grant execute on function public.marketplace_member_suggestions(text, text) to anon, authenticated;

-- ============ what's already been typed ============
-- Listings saved before this migration count too.
insert into public.marketplace_catalogue_votes (kind, brand_id, category, norm_key, label, user_id, listing_id)
select 'brand', '', l.category, public.marketplace_norm(l.brand_other), left(btrim(l.brand_other), 80), l.seller_id, l.id
  from public.listings l
 where l.brand = 'other' and l.brand_other is not null and l.seller_id is not null
   and char_length(coalesce(public.marketplace_norm(l.brand_other), '')) between 2 and 80
on conflict do nothing;

insert into public.marketplace_catalogue_votes (kind, brand_id, category, norm_key, label, user_id, listing_id)
select 'model', l.brand, l.category, public.marketplace_norm(l.model), left(btrim(l.model), 80), l.seller_id, l.id
  from public.listings l
 where l.brand is not null and l.brand not in ('other', 'unknown', 'mixed')
   and l.model_id is null and l.model is not null and l.seller_id is not null
   and char_length(coalesce(public.marketplace_norm(l.model), '')) between 2 and 80
on conflict do nothing;

-- Anything already typed by 5 or more sellers is learned now.
do $$
declare r record;
begin
  for r in select distinct kind, brand_id, category, norm_key from public.marketplace_catalogue_votes loop
    perform public.marketplace_learn(r.kind, r.brand_id, r.category, r.norm_key);
  end loop;
end $$;
