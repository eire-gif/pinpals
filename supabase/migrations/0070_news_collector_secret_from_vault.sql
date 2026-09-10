-- Pinpals News: read the collector's bearer token from Supabase Vault
-- instead of a database setting.
--
-- 0069 read the token from current_setting('app.news_cron_secret'), which
-- requires `alter database postgres set app.news_cron_secret = '...'`. That
-- stores the token as plain text in pg_db_role_setting, where any role able
-- to read pg_settings or call current_setting() can recover it. For a shared
-- secret that authorises a write endpoint, that is a weaker resting place
-- than it needs to be, and it was a poor default to ship.
--
-- supabase_vault is already installed on this project, so the token lives
-- there encrypted instead and the job decrypts it at fire time.
--
-- The site URL moves inline. It is public, it is already committed in this
-- repo, and keeping it out of database settings means the project needs no
-- `alter database ... set` at all — which also removes the elevated
-- privilege that statement required, and one more manual deployment step.
--
-- 0069 is left as it was rather than edited: it has already been applied to
-- the production database, and rewriting an applied migration makes the
-- migration history stop describing what actually happened.
--
-- OPERATOR STEP, run once in the Supabase SQL editor, with the same value as
-- NEWS_CRON_SECRET in Vercel:
--
--   select vault.create_secret(
--     '<the secret>',
--     'news_cron_secret',
--     'Bearer token for POST /api/news/collect'
--   );
--
-- To rotate it later (change Vercel first, then this):
--
--   select vault.update_secret(
--     (select id from vault.secrets where name = 'news_cron_secret'),
--     '<the new secret>'
--   );
--
-- Until that secret exists the job fires, sends the literal 'unset', and the
-- route answers 401. Nothing is collected and nothing is exposed, which is
-- the correct failure for a missing credential.
--
-- Rollback:
--   select cron.unschedule('pinpals-news-collect');
--   -- then re-run 0069 to restore the settings-based job.

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
        url     := 'https://pinpals.ie/api/news/collect',
        headers := jsonb_build_object(
          'Content-Type',  'application/json',
          -- coalesce so a missing secret sends a wrong token and gets a clean
          -- 401, rather than building a null header and erroring inside the
          -- job, which is harder to read in cron.job_run_details.
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
