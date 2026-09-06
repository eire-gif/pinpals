-- Buyer/seller reviews after a completed order. A review can only be left
-- by a participant of a *completed* order, about the other participant —
-- enforced in validate_review() since it needs a cross-table lookup RLS
-- can't express as a single self-contained check.
--
-- Rollback:
--   drop trigger if exists reviews_validate on public.reviews;
--   drop function if exists public.validate_review();
--   drop table if exists public.reviews cascade;

create table if not exists public.reviews (
  id bigint generated always as identity primary key,
  order_id bigint not null references public.orders (id) on delete cascade,
  reviewer_id uuid not null references public.profiles (id) on delete cascade,
  reviewee_id uuid not null references public.profiles (id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  body text check (char_length(body) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reviews_no_self_review_check check (reviewer_id <> reviewee_id),
  unique (order_id, reviewer_id)
);

create index if not exists reviews_order_id_idx on public.reviews (order_id);
create index if not exists reviews_reviewer_id_idx on public.reviews (reviewer_id);
create index if not exists reviews_reviewee_id_idx on public.reviews (reviewee_id);

drop trigger if exists reviews_set_updated_at on public.reviews;
create trigger reviews_set_updated_at
  before update on public.reviews
  for each row
  execute function public.set_updated_at();

alter table public.reviews enable row level security;

-- Reviews are public reputation info, like a seller rating — readable by
-- anyone, matching how listings/profiles are publicly browsable.
drop policy if exists "reviews are publicly readable" on public.reviews;
create policy "reviews are publicly readable"
  on public.reviews for select
  to public
  using (true);

drop policy if exists "participants can review their completed orders" on public.reviews;
create policy "participants can review their completed orders"
  on public.reviews for insert
  to authenticated
  with check ((select auth.uid()) = reviewer_id);

drop policy if exists "reviewers can update their own reviews" on public.reviews;
create policy "reviewers can update their own reviews"
  on public.reviews for update
  to authenticated
  using ((select auth.uid()) = reviewer_id)
  with check ((select auth.uid()) = reviewer_id);

drop policy if exists "reviewers can delete their own reviews" on public.reviews;
create policy "reviewers can delete their own reviews"
  on public.reviews for delete
  to authenticated
  using ((select auth.uid()) = reviewer_id);

create or replace function public.validate_review()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_buyer_id uuid;
  v_seller_id uuid;
  v_status text;
begin
  select buyer_id, seller_id, status
    into v_buyer_id, v_seller_id, v_status
    from public.orders
    where id = new.order_id;

  if not found then
    raise exception 'Order % not found', new.order_id;
  end if;

  if v_status <> 'completed' then
    raise exception 'Order % is not completed yet (status: %)', new.order_id, v_status;
  end if;

  if not (
    (new.reviewer_id = v_buyer_id and new.reviewee_id = v_seller_id)
    or (new.reviewer_id = v_seller_id and new.reviewee_id = v_buyer_id)
  ) then
    raise exception 'Reviewer and reviewee must be the buyer and seller of order %', new.order_id;
  end if;

  return new;
end;
$$;

revoke execute on function public.validate_review() from public, anon, authenticated;

drop trigger if exists reviews_validate on public.reviews;
create trigger reviews_validate
  before insert or update on public.reviews
  for each row
  execute function public.validate_review();
