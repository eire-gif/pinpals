-- Pinpals News, phase 1: the schedule.
--
-- This is the first scheduled job anywhere in this codebase. Everything up
-- to now has run inside a request some member triggered, or as an
-- opportunistic sweep riding along on one (release_expired_offer_reservations
-- is the pattern). A news collector cannot work that way — it has to run
-- when nobody is on the site.
--
-- Why pg_cron and not vercel.json:
--
--   The Vercel team plan is Hobby, which caps cron at one invocation per day.
--   Polling two press offices once a day is not a news service. pg_cron is
--   free, unmetered, and already available in the Supabase project, so the
--   schedule lives next to the data instead of costing a plan upgrade. If
--   the project ever moves to Vercel Pro this can be reconsidered, but there
--   is no functional reason to.
--
-- How it works: pg_cron fires on the Postgres side and pg_net makes an
-- outbound POST to the collector route, which does the actual fetching. The
-- database never talks to the press offices itself.
--
-- Two settings have to exist before the job can run, and they hold a URL and
-- a shared secret, so they are NOT in this migration — committing a secret
-- to the repo is how secrets leak. Set them once, by hand, in the Supabase
-- SQL editor:
--
--   alter database postgres set app.site_url = 'https://pinpals.ie';
--   alter database postgres set app.news_cron_secret = '<the NEWS_CRON_SECRET value from Vercel>';
--
-- The secret must match NEWS_CRON_SECRET in the Vercel environment exactly.
-- Until both are set the job runs and the route answers 401, which is the
-- correct failure: nothing collected, nothing exposed.
--
-- Cadence: every six hours. The spec originally called for daily triage, but
-- a prototype run showed two sources produce roughly three publishable
-- articles a fortnight — supply, not cost, is the constraint. Six-hourly
-- polling keeps latency low for the occasional big announcement without
-- pretending there is a daily news cycle to catch.
--
-- Rollback:
--   select cron.unschedule('pinpals-news-collect');
--   -- extensions are left installed; dropping them may affect other jobs.

-- The whole thing is guarded on pg_cron actually being available.
--
-- Supabase ships pg_cron and pg_net; a plain postgres:16 image does not, and
-- that image is what supabase/tests/rls/replay-migrations.sh and CI replay
-- every migration into. An unguarded `create extension pg_cron` would make
-- this file fail there, which would mean either excluding it from the replay
-- list — leaving it the one migration nothing ever checks — or breaking CI.
-- Skipping with a notice keeps the file replayable everywhere and still
-- loud about what did not happen.
do $$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    raise notice 'pg_cron is not available here, so the news collector schedule was NOT created. Expected on a local replay or in CI; on Supabase this must not happen.';
    return;
  end if;

  execute 'create extension if not exists pg_cron';
  execute 'create extension if not exists pg_net';

  -- Unschedule first so re-running this migration replaces the job rather
  -- than erroring or leaving two of them firing.
  if exists (select 1 from cron.job where jobname = 'pinpals-news-collect') then
    perform cron.unschedule('pinpals-news-collect');
  end if;

  perform cron.schedule(
    'pinpals-news-collect',
    -- 05:07, 11:07, 17:07, 23:07 UTC. Offset off the hour so it is
    -- distinguishable in logs from anything else that fires on the hour.
    '7 5,11,17,23 * * *',
    $job$
      select net.http_post(
        url     := current_setting('app.site_url', true) || '/api/news/collect',
        headers := jsonb_build_object(
          'Content-Type',  'application/json',
          'Authorization', 'Bearer ' || current_setting('app.news_cron_secret', true)
        ),
        body    := '{}'::jsonb,
        timeout_milliseconds := 55000
      );
    $job$
  );
end
$$;

-- pg_cron's own tables are superuser-owned and not reachable through
-- PostgREST, so there is nothing to grant or revoke here. Run history is
-- visible in the SQL editor:
--
--   select jobid, runid, status, return_message, start_time
--     from cron.job_run_details
--    where jobid = (select jobid from cron.job where jobname = 'pinpals-news-collect')
--    order by start_time desc
--    limit 20;
