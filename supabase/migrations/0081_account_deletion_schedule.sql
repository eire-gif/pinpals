-- Pinpals: run the account deletion scrub on a schedule.
--
-- 0080 added the request table and the blocking check; the deletion itself is
-- TypeScript, because it has to cancel tee times and tell the people who had
-- taken a place in them, and notifyUser() does not live in the database. This
-- migration is only the alarm clock: it POSTs to a route that does the work.
--
-- Same shape as the news collector (0069/0070) deliberately. One way of
-- scheduling things in this project, one place to look when a job has not
-- run, and one already-proven answer to "where does the bearer token live".
--
-- ONCE A DAY, NOT MORE. The grace period is thirty days, so a few hours
-- either side of the exact moment is invisible to a member, and a job that
-- deletes people should run at a predictable quiet hour rather than
-- constantly. 03:20 UTC is chosen to miss the news collector's :07 slots — a
-- backlog of scrubs and a sitemap crawl competing for the same function
-- instances is a needless way to make both slower.
--
-- OPERATOR STEP, run once in the Supabase SQL editor, with the same value as
-- ACCOUNT_DELETION_CRON_SECRET in Vercel:
--
--   select vault.create_secret(
--     '<the secret>',
--     'account_deletion_cron_secret',
--     'Bearer token for POST /api/account-deletions/run'
--   );
--
-- To rotate it later (change Vercel first, then this):
--
--   select vault.update_secret(
--     (select id from vault.secrets where name = 'account_deletion_cron_secret'),
--     '<the new secret>'
--   );
--
-- Until that secret exists the job fires, sends the literal 'unset', and the
-- route answers 401. Nothing is deleted, which is the correct failure for a
-- missing credential on an irreversible operation — requests simply wait in
-- the table and the first authorised run picks up all of them.
--
-- Rollback:
--   select cron.unschedule('pinpals-account-deletions');

do $$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    raise notice 'pg_cron is not available here, so the account deletion schedule was NOT created. Expected on a local replay or in CI.';
    return;
  end if;

  if exists (select 1 from cron.job where jobname = 'pinpals-account-deletions') then
    perform cron.unschedule('pinpals-account-deletions');
  end if;

  perform cron.schedule(
    'pinpals-account-deletions',
    -- 03:20 UTC daily.
    '20 3 * * *',
    $job$
      select net.http_post(
        url     := 'https://www.pinpals.ie/api/account-deletions/run',
        headers := jsonb_build_object(
          'Content-Type',  'application/json',
          -- coalesce so a missing secret sends a wrong token and gets a clean
          -- 401, rather than building a null header and erroring inside the
          -- job, which is harder to read in cron.job_run_details.
          'Authorization', 'Bearer ' || coalesce(
            (select decrypted_secret
               from vault.decrypted_secrets
              where name = 'account_deletion_cron_secret'
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
