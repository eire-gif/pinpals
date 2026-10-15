-- 0148 — golfapi bulk import: progress per club (Oct 2026).
--
-- The `bulk` action of the import-golfapi Edge Function works through every
-- club in the directory, cards only (no GPS), and records here what happened
-- to each one, so a run can stop and pick up again without paying twice, and
-- staff get a list of the clubs it wouldn't decide on its own.
--
--   status   imported  cards written (imported = what, per golfapi course)
--            review    not imported; `reason` says why, `candidates` holds
--                      what golfapi offered — staff finish it with the
--                      single-club `import` action
--            skipped   nothing to do (already has provider cards)
--            error     something failed; `reason` has the message. Retried
--                      only when asked (bulk with retry_errors)
--   calls    golfapi calls spent on this club
--
-- Staff/service only: RLS on, no policies, no grants. It holds golfapi's
-- search results, which fall under the same no-scraping duty as 0108.
--
-- Rollback:
--   drop function if exists public.golfapi_bulk_next(int, bigint[], boolean, boolean);
--   drop table if exists public.golfapi_bulk_clubs;

create table public.golfapi_bulk_clubs (
  club_id bigint primary key references public.clubs (id) on delete cascade,
  status text not null check (status in ('imported', 'review', 'skipped', 'error')),
  reason text,
  provider_club_id text,
  candidates jsonb,
  imported jsonb,
  calls numeric(6, 1) not null default 0,
  updated_at timestamptz not null default now()
);

create index golfapi_bulk_clubs_status_idx on public.golfapi_bulk_clubs (status);

comment on table public.golfapi_bulk_clubs is 'golfapi bulk card import: what happened to each club (imported / review / skipped / error). Service role only.';

alter table public.golfapi_bulk_clubs enable row level security;
revoke all on public.golfapi_bulk_clubs from anon, authenticated;

-- The next clubs to do, in country order (Ireland first) then name. A club
-- is due if it has no row yet — or, with p_retry_errors, if its row is an
-- error; or, with p_recheck_review, if it's on the review list with
-- golfapi's candidates saved (decided again from those, no new search).
-- p_club_ids limits the run to those clubs (tests, one-offs).
create or replace function public.golfapi_bulk_next(p_limit int, p_club_ids bigint[] default null, p_retry_errors boolean default false, p_recheck_review boolean default false)
returns table (id bigint, name text, country text, town text, latitude double precision, longitude double precision, has_provider_cards boolean, saved_candidates jsonb)
language sql
stable
security definer
set search_path = public
as $$
  select c.id, c.name, c.country, c.town, c.latitude, c.longitude,
         exists (select 1 from public.course_cards cc where cc.club_id = c.id and cc.source = 'provider'),
         case when b.status = 'review' then b.candidates end
  from public.clubs c
  left join public.golfapi_bulk_clubs b on b.club_id = c.id
  where (b.club_id is null
         or (p_retry_errors and b.status = 'error')
         or (p_recheck_review and b.status = 'review' and jsonb_array_length(coalesce(b.candidates, '[]'::jsonb)) > 0))
    and (p_club_ids is null or c.id = any (p_club_ids))
  order by coalesce(array_position(array['ireland', 'northern-ireland', 'england', 'scotland', 'wales', 'spain', 'portugal'], c.country), 99),
           c.name, c.id
  limit greatest(0, least(p_limit, 200));
$$;

revoke all on function public.golfapi_bulk_next(int, bigint[], boolean, boolean) from public, anon, authenticated;
grant execute on function public.golfapi_bulk_next(int, bigint[], boolean, boolean) to service_role;
