-- Pinpals News: point the collector at www.pinpals.ie, not the apex.
--
-- 0069/0070 posted to https://pinpals.ie/api/news/collect. The apex redirects
-- to www, and a redirect drops the Authorization header — so the request
-- arrived at the route with no credential at all and was refused. The route
-- was right to refuse it.
--
-- This cost an hour of looking in the wrong place, because a 401 is what a
-- WRONG secret looks like too. The secret was correct the whole time; it was
-- never being sent. The thing that actually found it was the log line added
-- in the same debugging session:
--
--   [news] collect auth rejected: presented 0 chars, configured 64 chars
--
-- "presented 0" is unambiguous — nothing arrived — and it is the difference
-- between "the credential is wrong" and "there is no credential". Worth
-- remembering the next time an authenticated call to our own site fails: check
-- that the URL is the one the site actually serves before touching the secret.
--
-- Verified after this change: a manual run returned 200 and inserted 30 items
-- from the CPG feed.
--
-- Rollback:
--   select cron.unschedule('pinpals-news-collect');
--   -- then re-run 0070 to restore the apex URL (which does not work).

do $$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    raise notice 'pg_cron is not available here, so the news collector schedule was NOT updated. Expected on a local replay or in CI.';
    return;
  end if;

  if exists (select 1 from cron.job where jobname = 'pinpals-news-collect') then
    perform cron.unschedule('pinpals-news-collect');
  end if;

  perform cron.schedule(
    'pinpals-news-collect',
    -- 05:07, 11:07, 17:07, 23:07 UTC.
    '7 5,11,17,23 * * *',
    $job$
      select net.http_post(
        -- www, not the apex. See this file's header.
        url     := 'https://www.pinpals.ie/api/news/collect',
        headers := jsonb_build_object(
          'Content-Type',  'application/json',
          'Authorization', 'Bearer ' || coalesce(
            (select decrypted_secret
               from vault.decrypted_secrets
              where name = 'news_cron_secret'
              limit 1),
            'unset'
          )
        ),
        body    := '{}'::jsonb,
        timeout_milliseconds := 55000
      );
    $job$
  );
end
$$;
