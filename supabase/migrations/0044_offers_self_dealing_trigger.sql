-- Hardens the "a user cannot make an offer on their own listing" rule so it
-- holds regardless of caller — not just under RLS.
--
-- offers' existing "buyers can create offers" policy (0032) already blocks
-- this for any request going through PostgREST as an authenticated user.
-- But RLS is bypassed by the service-role client (which is exactly what
-- respondToOffer() and every Stripe webhook handler in this codebase use)
-- and by a superuser/direct-SQL connection. Verified while testing this
-- migration set: an insert run as a superuser sailed straight through the
-- RLS policy. auctions/bids (0039) already avoid this gap with a
-- role-independent BEFORE INSERT trigger; this migration brings offers to
-- the same standard, as defense-in-depth alongside (not instead of) the
-- existing RLS policy.
--
-- Rollback:
--   drop trigger if exists offers_prevent_self_dealing on public.offers;
--   drop function if exists public.prevent_offer_self_dealing();

create or replace function public.prevent_offer_self_dealing()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seller_id uuid;
begin
  select seller_id into v_seller_id from public.listings where id = new.listing_id;

  if v_seller_id is null then
    raise exception 'Listing % not found', new.listing_id;
  end if;

  if v_seller_id = new.buyer_id then
    raise exception 'Sellers cannot make offers on their own listing';
  end if;

  return new;
end;
$$;

revoke execute on function public.prevent_offer_self_dealing() from public, anon, authenticated;

drop trigger if exists offers_prevent_self_dealing on public.offers;
create trigger offers_prevent_self_dealing
  before insert on public.offers
  for each row
  execute function public.prevent_offer_self_dealing();
