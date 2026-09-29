-- How many people have saved each of MY listings.
--
-- THE BUG THIS FIXES. listing_favourites (0037) has exactly one policy:
--
--     using ((select auth.uid()) = user_id)
--
-- which is correct for a wishlist — nobody should see who saved what. But
-- it means a seller counting saves on their own listings counts only their
-- OWN saves, so the "hearts" figure on /dashboard/selling's listings tab has
-- always been zero (or one, for a seller who favourited their own listing).
-- The count query there is fine; there was simply never a row it was allowed
-- to see. The app's new Selling screen would have reproduced the same
-- permanently-zero number, which is how this was noticed.
--
-- SECURITY DEFINER, and why it has to be. Every other aggregate this app
-- exposes is SECURITY INVOKER, summing rows the caller could already read
-- one by one. This one cannot be: the whole point is that the caller may not
-- read these rows. So it runs as the owner, and the scoping is inside the
-- function body rather than in a policy:
--
--   * `l.seller_id = auth.uid()` is the real boundary. A caller may pass any
--     listing ids they like and will get counts back only for listings they
--     own; ids belonging to anyone else simply produce no row.
--   * It returns counts, never identities. There is no shape of this result
--     that says which member saved anything.
--   * `set search_path = public` so the tables it resolves cannot be
--     shadowed by a caller-controlled search path.
--
-- The revoke is BY NAME on purpose. Supabase grants execute to anon and
-- authenticated explicitly, so `revoke ... from public` alone leaves those
-- two grants in place — see claude/incident-notify-user-grants-after-
-- recreate.md, which is the incident that taught us this.
--
-- Rollback: `drop function if exists public.listing_favourite_counts(bigint[]);`

create or replace function public.listing_favourite_counts(p_listing_ids bigint[])
returns table (listing_id bigint, favourites bigint)
language sql
stable
security definer
set search_path = public
as $$
  select f.listing_id, count(*)::bigint as favourites
  from public.listing_favourites f
  join public.listings l on l.id = f.listing_id
  where f.listing_id = any(p_listing_ids)
    and l.seller_id = (select auth.uid())
  group by f.listing_id;
$$;

revoke all on function public.listing_favourite_counts(bigint[])
  from public, anon, authenticated;

grant execute on function public.listing_favourite_counts(bigint[])
  to authenticated;

comment on function public.listing_favourite_counts(bigint[]) is
  'Save counts for the caller''s own listings. SECURITY DEFINER because listing_favourites is readable only by the member who saved; scoped by seller_id inside the body, and returns counts only, never who saved.';
