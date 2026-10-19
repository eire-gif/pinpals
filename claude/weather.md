# Weather (Oct 2026, migration 0182)

Mock-ups: the "PinPals Weather mock-ups" design canvas. Decision (Eire, 19 Oct 2026): **don't change any app screens — add the feature to them.** So each piece is one slim row inside the existing layout, and draws nothing when there's no weather.

## What members see
- **Live scoring** (Score tab, above the hole card, while the round is live): the weather now — temperature, wind and gusts with where it's from — and a gold "Rain ~20 min" tag when rain is 50%+ likely within the hour or so. Refreshes every 15 minutes.
- **Scorecard**: a "Played in" row under the summary — e.g. "9° · wind 22 mph, gusts 35 from the W · showers, 3 mm". Appears once the card's weather has been looked up (a few minutes after the round, or by the backfill for older cards).
- **My rounds** (each upcoming round card): the forecast from the tee time for about 4½ hours — temperature, kind, wind and the likeliest rain. More than ~10 days out: "Forecast from Tue 27 Oct".
- **My Game → In the weather**: average strokes over par a hole when calm (under 10 mph), breezy (10–20), windy (over 20), dry and in rain — from the weather saved on the member's cards, hidden until 18 holes in a band.
- Every row names the weather service, linked, as its terms ask. Wind is mph unless the member chose metres on the hole map.

## How it works
- **Source**: the hole map's wind service (`src/lib/wind.ts`): Apple WeatherKit when its four Vercel settings are there, else Open-Meteo. `WIND_PROVIDER=off` turns all weather off. **Open-Meteo's free service is non-commercial: add the WeatherKit keys before launch.**
- `src/lib/weather.ts` — `forecastAt` (now + 10 days hourly, cached 30 min per ~1 km) and `pastHours` (WeatherKit history from Aug 2021; Open-Meteo forecast API for the last ~85 days, archive before that).
- `src/lib/weather-rules.ts` — the shared hour shape, each service's codes to one `kind`, `summariseRound`, `roundWindow` (live round: set-up to finish, max 6 h, 4½ h if never finished; hand-typed card: 09:00–13:00 UTC), `readyForWeather`.
- `GET /api/app/weather?lat&lng` → `{ forecast }` for the app (members only).
- **Saving on cards**: `POST /api/weather/scorecards/run` (`src/lib/scorecard-weather.ts`), called by pg_cron job `pinpals-scorecard-weather` every 10 minutes while a card is waiting. 60 cards a run, newest first; one call per fourball. Backfills every existing card, past society outings included.
- App: `mobile/src/lib/weather-rules.ts` (pure, tested), `mobile/src/lib/weather.ts` (reads), `mobile/src/components/weather-bits.tsx` (`LiveWeatherRow`, `ForecastRow`, `ConditionsRow`). `MyRound.teeTime` added for the forecast (`my-rounds-rules.ts`, byte-identical in site and app).

## Database (0182_scorecard_weather.sql)
- `scorecards.weather` jsonb (`RoundWeather`: v, tempC, windKmh, gustKmh, fromDeg, rainMm, wet, kind, from, to, credit) and `scorecards.weather_checked_at` (null = waiting; set when looked up, found or not, so nothing is asked twice).
- Written only by the service role; read with the card under the existing RLS. No new grants.
- Trigger `scorecards_weather_reset`: a hand edit that changes the course or date sends the card back to waiting. The certification hash (0128) doesn't include weather, so filling it never voids a certificate.
- The app falls back to loading cards without `weather` if 0182 isn't applied yet.

## Verified
- Full replay of 182 migrations. RLS 1056/1056, including `scorecard-weather.test.ts` (3: job-only writes, read with the card, reset on course/date change, certificate untouched).
- Site: tsc clean, unit tests (new `weather-rules.test.ts`, 11). App: tsc clean, `mobile/src/lib/weather-rules.test.ts` (9).
- Not run on a phone yet.

## To ship
1. Apply `0182_scorecard_weather.sql` to production (it schedules the job).
2. Optional: a `weather_cron_secret` in the vault matching `WEATHER_CRON_SECRET` in Vercel; without it the job uses the existing scheduled-jobs secret (`account_deletion_cron_secret` / `ACCOUNT_DELETION_CRON_SECRET`).
3. Merge (Vercel deploys the two routes), then `cd mobile && eas update --branch production --platform ios`.
4. Before launch: WeatherKit keys in Vercel (`WEATHERKIT_TEAM_ID`, `WEATHERKIT_SERVICE_ID`, `WEATHERKIT_KEY_ID`, `WEATHERKIT_PRIVATE_KEY`).

## Not done / next
- The evening-before warning when the forecast turns rough (needs a new notification type in site and app, and the member's notification settings).
- Forecast on society event pages and group rounds (only tee times on My rounds today).
- Per-hole into/behind wind on the scorecard (needs each hole's bearing from the hole map).
