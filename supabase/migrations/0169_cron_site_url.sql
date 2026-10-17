-- 0169 — One place for the website address the scheduled jobs call (Oct 2026)
--
-- Four pg_cron jobs post to the website (news collect, account deletions,
-- society alerts, competition alerts). Each had 'https://www.pinpals.ie'
-- written into it (0071, 0081, 0143, 0148), so a rename (ForePals) or a move
-- would quietly stop all four.
--
-- Now they call public.pinpals_site_url(), which reads the Vault secret
-- 'pinpals_site_url' and falls back to https://www.pinpals.ie. Nothing
-- changes today. To move the site later, one statement:
--
--   select vault.create_secret('https://www.newname.com', 'pinpals_site_url');
--   -- or, if it exists: select vault.update_secret(id, 'https://...') ...
--
-- No trailing slash. Only the URL in each job changes; headers, secrets,
-- timeouts and schedules are untouched (replace() on the stored command).
--
-- Rollback:
--   update the four jobs back with
--     select cron.alter_job(jobid, command := replace(command,
--       'public.pinpals_site_url() || ''/api/', '''https://www.pinpals.ie/api/'))
--     from cron.job where command like '%pinpals_site_url()%';
--   then: drop function if exists public.pinpals_site_url();

create or replace function public.pinpals_site_url()
returns text
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
-- plpgsql, not sql: the body isn't checked until it runs, so this applies on
-- the local test database, which has no Vault (same as 0109).
begin
  return coalesce(
    (select nullif(btrim(decrypted_secret), '') from vault.decrypted_secrets where name = 'pinpals_site_url' limit 1),
    'https://www.pinpals.ie'
  );
end;
$function$;

revoke all on function public.pinpals_site_url() from public, anon, authenticated;

comment on function public.pinpals_site_url() is
  'The website the scheduled jobs post to (0169). Vault secret pinpals_site_url, else https://www.pinpals.ie.';

-- The jobs only exist in production; on a fresh database this does nothing.
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.alter_job(
      j.jobid,
      command := replace(j.command, '''https://www.pinpals.ie/api/', 'public.pinpals_site_url() || ''/api/')
    )
    from cron.job j
    where j.command like '%''https://www.pinpals.ie/api/%';
  end if;
end $$;
