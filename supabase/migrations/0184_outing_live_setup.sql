-- 0184 — Save a society day's live set-up in advance (Oct 2026)
--
-- Asked by Eire, 21 Oct 2026: on the website's Live day, the round can only
-- be started on the day of the event, so the organiser wants to choose the
-- tees, card, format and start ahead of time and just press Start on the
-- morning.
--
-- society_outings.live_setup: the organiser's choices as the Live day page
-- sends them (tee name, rating, slope, the card's par and stroke index per
-- hole, format, how pairs are ranked, tee times or shotgun and its time,
-- secret leaderboard). Nothing in it is trusted when the round starts: the
-- page reads it back into the form, and the Server Action checks every value
-- again and rebuilds players, handicaps and groups from the draw.
--
-- Written only through save_outing_live_setup: an officer of the society
-- with the events area (outing_officer, 0144), an open day out that hasn't
-- started, at most 8 KB. Null clears it. Read like the rest of the outing
-- (members of the society, 0125).
--
-- No drop statements.
--
-- Rollback:
--   drop function if exists public.save_outing_live_setup(bigint, jsonb);
--   alter table public.society_outings drop column if exists live_setup, drop column if exists live_setup_at;

alter table public.society_outings
  add column if not exists live_setup jsonb,
  add column if not exists live_setup_at timestamptz;

comment on column public.society_outings.live_setup is
  'Live day (0184): the organiser''s saved set-up for starting the round — tees, card, format, start. Checked again when the round starts.';

create or replace function public.save_outing_live_setup(p_outing_id bigint, p_setup jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := (select auth.uid());
  o public.society_outings%rowtype;
begin
  select * into o from public.society_outings where id = p_outing_id;
  if not found or not public.outing_officer(o.group_id, me) then
    raise exception 'Only the captain, secretary or event organisers can set up the round.' using errcode = '42501';
  end if;
  if o.status <> 'open' then raise exception 'This outing was cancelled.'; end if;
  if coalesce(o.kind, 'day') <> 'day' then raise exception 'A trip''s rounds are set up on its itinerary.'; end if;
  if o.match_day_id is not null then raise exception 'The round has already started.'; end if;
  if p_setup is not null and (jsonb_typeof(p_setup) <> 'object' or pg_column_size(p_setup) > 8192) then
    raise exception 'That set-up doesn''t look right.' using errcode = '22023';
  end if;

  update public.society_outings
     set live_setup = p_setup,
         live_setup_at = case when p_setup is null then null else now() end
   where id = p_outing_id;
end;
$$;
revoke all on function public.save_outing_live_setup(bigint, jsonb) from public, anon, authenticated;
grant execute on function public.save_outing_live_setup(bigint, jsonb) to authenticated;
