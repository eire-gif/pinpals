-- 0182 — The weather a round was played in, saved on its scorecards (Oct 2026)
--
-- Members wanted the conditions on their cards and in My Game — "how do I
-- score in the wind?" — including past society outings. The weather comes
-- from the same service as the hole map's wind (src/lib/wind.ts,
-- src/lib/weather.ts): Apple WeatherKit once its keys are in Vercel, else
-- Open-Meteo.
--
--   scorecards.weather            jsonb, null until looked up or when there's
--                                 none: { v, tempC, windKmh, gustKmh, fromDeg,
--                                 rainMm, wet, kind, from, to, credit }
--                                 (RoundWeather in src/lib/weather-rules.ts).
--   scorecards.weather_checked_at when it was looked up, found or not. Null =
--                                 waiting. Every existing card starts waiting,
--                                 so the job works back through them all.
--
-- Written only by the site's job (service role), POST
-- /api/weather/scorecards/run (src/lib/scorecard-weather.ts), called below
-- every ten minutes while a card is waiting. Members read it with the rest of
-- the card under the existing RLS; nothing new is granted.
--
-- A card whose course or date is changed by hand goes back to waiting.
-- Changing the weather doesn't touch the certification hash (0128 hashes the
-- course, date, ratings and holes only).
--
-- Rollback:
--   select cron.unschedule('pinpals-scorecard-weather');
--   drop trigger if exists scorecards_weather_reset on public.scorecards;
--   drop function if exists public.scorecards_weather_reset();
--   alter table public.scorecards drop column if exists weather, drop column if exists weather_checked_at;

alter table public.scorecards
  add column if not exists weather jsonb,
  add column if not exists weather_checked_at timestamptz;

create index if not exists scorecards_weather_waiting_idx
  on public.scorecards (played_on desc, id desc)
  where weather_checked_at is null;

-- A new course or date means different weather: look it up again.
create or replace function public.scorecards_weather_reset()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.club_id is distinct from old.club_id or new.played_on is distinct from old.played_on then
    new.weather := null;
    new.weather_checked_at := null;
  end if;
  return new;
end;
$$;

revoke all on function public.scorecards_weather_reset() from public, anon, authenticated;

drop trigger if exists scorecards_weather_reset on public.scorecards;
create trigger scorecards_weather_reset
  before update of club_id, played_on on public.scorecards
  for each row execute function public.scorecards_weather_reset();

-- ============ Schedule ============

do $$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    raise notice 'pg_cron is not available here, so the scorecard weather schedule was NOT created. Expected on a local replay or in CI.';
    return;
  end if;
  if exists (select 1 from cron.job where jobname = 'pinpals-scorecard-weather') then
    perform cron.unschedule('pinpals-scorecard-weather');
  end if;
  perform cron.schedule(
    'pinpals-scorecard-weather',
    '*/10 * * * *',
    $job$
      select net.http_post(
        url     := 'https://www.pinpals.ie/api/weather/scorecards/run',
        headers := jsonb_build_object(
          'Content-Type',  'application/json',
          'Authorization', 'Bearer ' || coalesce(
            (select decrypted_secret from vault.decrypted_secrets where name = 'weather_cron_secret' limit 1),
            (select decrypted_secret from vault.decrypted_secrets where name = 'account_deletion_cron_secret' limit 1),
            'unset'
          )
        ),
        body    := '{}'::jsonb,
        timeout_milliseconds := 55000
      )
      where exists (select 1 from public.scorecards where weather_checked_at is null and played_on <= current_date);
    $job$
  );
end
$$;
