-- Rate limits that count recipients, not clicks (security review, Oct 2026).
--
-- check_rate_limit() adds 1 per call. A society email import sends up to 500
-- emails in one call, so "N imports a day" said nothing about how many
-- emails went out. This adds p_cost to the same fixed-window counter: the
-- import charges one hit per address.
--
-- Same table, same window maths and cleanup as check_rate_limit (0031).
-- Server only — called through the service-role client in src/lib/rate-limit.ts.

create or replace function public.check_rate_limit_cost(
  p_key text,
  p_max_hits int,
  p_window_seconds int,
  p_cost int
)
returns table (allowed boolean, retry_after_seconds int)
language plpgsql
set search_path = public
as $$
declare
  v_window_start timestamptz;
  v_hits int;
  v_cost int := greatest(1, coalesce(p_cost, 1));
begin
  v_window_start := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);

  -- Only charge what fits: a refused import doesn't use up the allowance.
  select hits into v_hits from public.rate_limit_hits
   where rl_key = p_key and window_start = v_window_start
   for update;

  if coalesce(v_hits, 0) + v_cost > p_max_hits then
    return query select false,
      greatest(0, p_window_seconds - floor(extract(epoch from now() - v_window_start))::int);
    return;
  end if;

  insert into public.rate_limit_hits (rl_key, window_start, hits)
  values (p_key, v_window_start, v_cost)
  on conflict (rl_key, window_start)
    do update set hits = public.rate_limit_hits.hits + v_cost;

  if random() < 0.01 then
    delete from public.rate_limit_hits where window_start < now() - interval '2 days';
  end if;

  return query select true,
    greatest(0, p_window_seconds - floor(extract(epoch from now() - v_window_start))::int);
end;
$$;

revoke all on function public.check_rate_limit_cost(text, int, int, int) from public, anon, authenticated;
grant execute on function public.check_rate_limit_cost(text, int, int, int) to service_role;

-- Brand logos: no SVG (security review, Oct 2026). An SVG can carry script
-- that runs on the storage host when its public link is opened. The upload
-- form and admin action no longer offer it; the bucket now refuses it too.
-- (No SVG logos had been uploaded.)
update storage.buckets
   set allowed_mime_types = array['image/png', 'image/webp', 'image/jpeg']
 where id = 'brand-logos';
