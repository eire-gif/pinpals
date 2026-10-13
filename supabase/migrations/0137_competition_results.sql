-- 0137 — Competition results (Oct 2026)
--
-- After a society day, scramble or foursomes day, the organiser publishes
-- the results: 1st, 2nd and 3rd (per division), best gross, the prizes the
-- cards can't decide (nearest the pin, longest drive), and how every tie
-- was broken. Design: claude/competition-results.md.
--
-- THE RULES live in one pure file, lib/competition-results.ts (website and
-- app, byte-identical): ties by the R&A's matching-scorecards method
-- (Committee Procedures 5A(6)d), which Golf Ireland clubs use — last 9, 6,
-- 3, 18th, then the front 9's last 6, 3 and 9th; net stroke play takes ½,
-- ⅓, ⅙, 1⁄18 of the handicap off, unrounded; still level, shared or drawn,
-- as the organiser set before publishing.
--
-- WHAT IS STORED, per day (live_match_days):
--   settings   the organiser's choices: tie rule, divisions, best gross,
--              one prize per player, guests, nearest-the-pin/longest-drive
--              winners. Saved as they change, so the draft survives.
--   results    the published result as worked out on the organiser's
--              phone (plain JSON from buildResults). Stored, not
--              recomputed: what members were told is exactly what stays
--              shown and shared, and a later correction is a new version.
--   version    1 on first publish, +1 on each republish ("Updated").
--   share_token  random; the public results page /results/<token> and its
--              link-preview image read the published copy by it (service
--              role, website). Never set before publishing.
--
-- WHO: only the day's organiser (live_match_days.created_by) saves,
-- publishes or withdraws. Everyone in the day reads the published results;
-- the organiser also reads the draft. No direct writes: SECURITY DEFINER
-- functions only, EXECUTE revoked from public and anon by name (0076).
--
-- PUBLISHING CLOSES THE CARDS: every round of the day still 'live' is
-- finished, so scores can't change under published results (a card not
-- complete stays as it is and can't place, which the organiser is shown
-- before publishing).
--
-- competition_card_status(): for the results screen, whether each player's
-- card from the day has been certified by a playing partner (0128). Cards
-- are private to their owner, so this answers yes/no per player only, and
-- only to someone in the day.
--
-- No drop statements: safe for the Supabase tool.
--
-- Rollback:
--   drop function if exists public.competition_results_save(bigint, jsonb);
--   drop function if exists public.competition_results_publish(bigint, jsonb);
--   drop function if exists public.competition_results_withdraw(bigint);
--   drop function if exists public.competition_card_status(bigint);
--   drop table if exists public.competition_results;

create table if not exists public.competition_results (
  match_day_id bigint primary key references public.live_match_days (id) on delete cascade,
  settings jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object' and pg_column_size(settings) <= 16384),
  status text not null default 'draft' check (status in ('draft', 'published')),
  results jsonb check (results is null or (jsonb_typeof(results) = 'object' and pg_column_size(results) <= 524288)),
  version integer not null default 0 check (version >= 0),
  share_token text unique check (share_token is null or share_token ~ '^[0-9a-f]{32}$'),
  published_at timestamptz,
  published_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  check (status = 'draft' or (results is not null and share_token is not null and published_at is not null))
);

comment on table public.competition_results is
  'A day''s competition results (0137): the organiser''s settings, and the published result (stored as worked out, versioned). Written only via competition_results_* functions.';

alter table public.competition_results enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'competition_results' and policyname = 'Players read published results; the organiser reads the draft') then
    create policy "Players read published results; the organiser reads the draft" on public.competition_results
      for select to authenticated
      using (
        exists (select 1 from public.live_match_days d where d.id = match_day_id and d.created_by = (select auth.uid()))
        or (status = 'published' and public.can_view_match_day(match_day_id))
      );
  end if;
end $$;

revoke insert, update, delete, truncate, references, trigger on public.competition_results from authenticated;
revoke all on public.competition_results from anon;

-- ---------------------------------------------------------------------------
-- The organiser's settings (draft)
-- ---------------------------------------------------------------------------

create or replace function public.competition_results_save(p_day_id bigint, p_settings jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.live_match_days where id = p_day_id and created_by = (select auth.uid())) then
    raise exception 'Only the organiser can set up the results' using errcode = '42501';
  end if;
  if p_settings is null or jsonb_typeof(p_settings) <> 'object' or pg_column_size(p_settings) > 16384 then
    raise exception 'Those settings can''t be saved' using errcode = '22023';
  end if;

  insert into public.competition_results (match_day_id, settings)
  values (p_day_id, p_settings)
  on conflict (match_day_id) do update set settings = excluded.settings, updated_at = now();
end;
$$;

revoke all on function public.competition_results_save(bigint, jsonb) from public;
revoke execute on function public.competition_results_save(bigint, jsonb) from anon;
grant execute on function public.competition_results_save(bigint, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Publishing (and republishing a correction)
-- ---------------------------------------------------------------------------

create or replace function public.competition_results_publish(p_day_id bigint, p_results jsonb)
returns table (version integer, share_token text)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_me uuid := (select auth.uid());
begin
  if not exists (select 1 from public.live_match_days where id = p_day_id and created_by = v_me) then
    raise exception 'Only the organiser can publish the results' using errcode = '42501';
  end if;
  if p_results is null or jsonb_typeof(p_results) <> 'object'
     or coalesce(jsonb_typeof(p_results -> 'divisions'), '') <> 'array' or pg_column_size(p_results) > 524288 then
    raise exception 'Those results can''t be published' using errcode = '22023';
  end if;

  -- Close the cards: no score changes under published results.
  update public.live_rounds
     set status = 'finished', finished_at = coalesce(finished_at, now())
   where match_day_id = p_day_id and status = 'live';

  insert into public.competition_results as cr (match_day_id, status, results, version, share_token, published_at, published_by)
  values (p_day_id, 'published', p_results, 1, replace(gen_random_uuid()::text, '-', ''), now(), v_me)
  on conflict (match_day_id) do update
    set status = 'published',
        results = excluded.results,
        version = cr.version + 1,
        share_token = coalesce(cr.share_token, excluded.share_token),
        published_at = now(),
        published_by = v_me,
        updated_at = now();

  return query select cr.version, cr.share_token from public.competition_results cr where cr.match_day_id = p_day_id;
end;
$$;

revoke all on function public.competition_results_publish(bigint, jsonb) from public;
revoke execute on function public.competition_results_publish(bigint, jsonb) from anon;
grant execute on function public.competition_results_publish(bigint, jsonb) to authenticated;

-- Taking results down (published by mistake): back to a draft. The share
-- link stops working; the version count is kept so a republish reads as an
-- update. Cards stay closed.
create or replace function public.competition_results_withdraw(p_day_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.live_match_days where id = p_day_id and created_by = (select auth.uid())) then
    raise exception 'Only the organiser can withdraw the results' using errcode = '42501';
  end if;
  update public.competition_results
     set status = 'draft', results = null, share_token = null, published_at = null, updated_at = now()
   where match_day_id = p_day_id;
end;
$$;

revoke all on function public.competition_results_withdraw(bigint) from public;
revoke execute on function public.competition_results_withdraw(bigint) from anon;
grant execute on function public.competition_results_withdraw(bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- Which cards are certified (yes/no per player)
-- ---------------------------------------------------------------------------

create or replace function public.competition_card_status(p_day_id bigint)
returns table (round_id bigint, member_id uuid, certified boolean)
language sql
security definer
stable
set search_path = public
as $$
  select p.round_id, p.member_id,
         exists (
           select 1
             from public.scorecards s
             join public.scorecard_certifications c on c.scorecard_id = s.id and c.status = 'certified'
            where s.live_round_id = p.round_id and s.member_id = p.member_id
         ) as certified
    from public.live_rounds r
    join public.live_round_players p on p.round_id = r.id
   where r.match_day_id = p_day_id
     and p.member_id is not null
     and public.can_view_match_day(p_day_id);
$$;

revoke all on function public.competition_card_status(bigint) from public;
revoke execute on function public.competition_card_status(bigint) from anon;
grant execute on function public.competition_card_status(bigint) to authenticated;
