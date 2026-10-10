-- 0117 — Members can't promote their own listings for free (Oct 2026)
--
-- 0115 added listings.featured_until and listings.bumped_at, set by
-- activate_listing_promotion() once Stripe says a promotion is paid. But the
-- listings UPDATE policy lets a seller write any column of their own row,
-- so a member could have set featured_until = 2099 themselves.
--
-- This trigger keeps both columns as they were whenever the writer is a
-- member (the authenticated or anon role) who isn't staff: on INSERT they
-- start empty, on UPDATE they can't move. The service role (the Stripe
-- webhook) and staff are unaffected.
--
-- SECURITY INVOKER on purpose: current_user is then the caller's role. A
-- member's call into a SECURITY DEFINER function (create_purchase_order and
-- friends) runs as the owner and passes, which is fine — none of those
-- touch these two columns.
--
-- Rollback: drop trigger listings_guard_promotion on public.listings;
--           drop function public.listings_guard_promotion();

create or replace function public.listings_guard_promotion()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('authenticated', 'anon') and not public.is_staff() then
    if tg_op = 'INSERT' then
      new.featured_until := null;
      new.bumped_at := null;
    else
      new.featured_until := old.featured_until;
      new.bumped_at := old.bumped_at;
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.listings_guard_promotion() from public, anon, authenticated;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'listings_guard_promotion') then
    create trigger listings_guard_promotion
      before insert or update on public.listings
      for each row execute function public.listings_guard_promotion();
  end if;
end $$;
