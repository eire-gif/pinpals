-- 0116 — The marketplace search lists USED gear only (Oct 2026)
--
-- With pro shops (0115) the marketplace splits into New Gear (shop stock,
-- retailer products) and Used Gear (members' own listings). The one search
-- function (search_marketplace_listings, 0060), used by the website and the
-- app, becomes the Used Gear search: shop listings are left out. Shop stock
-- is browsed from its own New Gear queries.
--
-- Rewritten mechanically from the live definition — one condition added to
-- each of its three branches — so nothing else in it drifts.
--
-- Rollback: the same replace in reverse.

do $$
declare
  v_def text;
  v_fn regprocedure := 'public.search_marketplace_listings(text, text, text, text, text, text, text, integer, integer, text, timestamptz, integer, bigint, integer, text[])'::regprocedure;
begin
  v_def := pg_get_functiondef(v_fn);
  if position('l.store_id is null' in v_def) > 0 then
    return;
  end if;
  if position('where l.status = ''active''' in v_def) = 0 then
    raise exception 'Anchor not found in search_marketplace_listings';
  end if;
  v_def := replace(v_def, 'where l.status = ''active''', 'where l.status = ''active'' and l.store_id is null');
  execute v_def;
end $$;
