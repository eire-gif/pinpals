-- Post kinds and golf details: the composer's post types (Oct 2026 feed
-- redesign, phase 3).
--
-- Two columns on posts rather than three new tables:
--
--   kind     'general' | 'round' | 'hole' | 'shot'
--   details  the golf facts for that kind, as JSON; null for 'general'
--
-- WHY NOT TABLES. A round, a hole and a shot here are what a member chose to
-- share in one post, not a scorecard system: they are read only with the
-- post, never queried across posts, and their fields will grow as the
-- composer does. A jsonb column with a strict check below gives the same
-- guarantees a table would (known keys, right types, sane ranges) without a
-- join on every feed page or a migration per new optional field.
--
-- NOTHING HERE DUPLICATES EXISTING DATA. Before this there was no score,
-- hole or shot data anywhere in PinPals: tee_time_invites holds when and
-- where a round will be played, not how it went, and clubs has no per-hole
-- par or yardage. Course stays posts.club_id, as before. There are no map,
-- coordinate or shot-path keys because nothing captures them yet.
--
-- THE SHAPES are defined once in TypeScript — src/lib/post-details.ts and
-- its identical copy in the app — and post_details_valid() below enforces
-- the same rules. Keep the three in step; supabase/tests/rls/post-kinds.test.ts
-- checks the database half.
--
-- "Photo / video" and "Find players" in the composer are not kinds: the
-- first is a general post, the second hands off to the tee-time flow.
--
-- Rollback:
--   alter table public.posts drop constraint if exists posts_details_valid;
--   alter table public.posts drop column if exists details, drop column if exists kind;
--   drop function if exists public.post_details_valid(text, jsonb);
--   grant insert (author_id, body, visibility, club_id) on public.posts to authenticated;

-- ============ the validator ============

-- An integer JSON number in [lo, hi]; `required` decides whether absence passes.
create or replace function public.post_detail_int(d jsonb, key text, lo int, hi int, required boolean)
returns boolean
language sql
immutable
set search_path = public
as $$
  select case
    when not (d ? key) then not required
    when jsonb_typeof(d->key) <> 'number' then false
    when (d->>key)::numeric <> trunc((d->>key)::numeric) then false
    else (d->>key)::numeric between lo and hi
  end;
$$;

-- Non-blank JSON text no longer than `max`; absence passes.
create or replace function public.post_detail_text(d jsonb, key text, max int)
returns boolean
language sql
immutable
set search_path = public
as $$
  select case
    when not (d ? key) then true
    when jsonb_typeof(d->key) <> 'string' then false
    else length(btrim(d->>key)) > 0 and length(d->>key) <= max
  end;
$$;

create or replace function public.post_details_valid(p_kind text, d jsonb)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare
  k text;
  allowed text[];
  b jsonb;
begin
  if p_kind = 'general' then
    return d is null;
  end if;
  if d is null or jsonb_typeof(d) <> 'object' then
    return false;
  end if;
  if pg_column_size(d) > 2048 then
    return false;
  end if;

  allowed := case p_kind
    when 'round' then array['score','holes','course_par','tee','played_on','differential',
                            'fairways_hit','fairways_total','gir','putts','best_hole']
    when 'hole'  then array['hole','par','yards','score']
    when 'shot'  then array['hole','shot_number','club','distance_yards','lie','result']
    else null
  end;
  if allowed is null then
    return false;
  end if;
  for k in select jsonb_object_keys(d) loop
    if not (k = any(allowed)) then
      return false;
    end if;
  end loop;

  if p_kind = 'round' then
    if not public.post_detail_int(d, 'score', 18, 200, true) then return false; end if;
    if d ? 'holes' and not (d->'holes' = '9'::jsonb or d->'holes' = '18'::jsonb) then return false; end if;
    if not public.post_detail_int(d, 'course_par', 27, 80, false) then return false; end if;
    if not public.post_detail_text(d, 'tee', 20) then return false; end if;
    if d ? 'played_on' then
      if jsonb_typeof(d->'played_on') <> 'string' or (d->>'played_on') !~ '^\d{4}-\d{2}-\d{2}$' then return false; end if;
      begin
        if to_char((d->>'played_on')::date, 'YYYY-MM-DD') <> d->>'played_on' then return false; end if;
      exception when others then
        return false;
      end;
    end if;
    if d ? 'differential' then
      if jsonb_typeof(d->'differential') <> 'number'
         or (d->>'differential')::numeric not between -10 and 60 then return false; end if;
    end if;
    if not public.post_detail_int(d, 'fairways_hit', 0, 18, false) then return false; end if;
    if not public.post_detail_int(d, 'fairways_total', 0, 18, false) then return false; end if;
    if not public.post_detail_int(d, 'gir', 0, 18, false) then return false; end if;
    if not public.post_detail_int(d, 'putts', 0, 99, false) then return false; end if;
    if d ? 'fairways_hit' and d ? 'fairways_total'
       and (d->>'fairways_hit')::int > (d->>'fairways_total')::int then return false; end if;
    if d ? 'best_hole' then
      b := d->'best_hole';
      if jsonb_typeof(b) <> 'object' then return false; end if;
      for k in select jsonb_object_keys(b) loop
        if not (k = any(array['hole','par','score'])) then return false; end if;
      end loop;
      if not public.post_detail_int(b, 'hole', 1, 27, true) then return false; end if;
      if not public.post_detail_int(b, 'par', 3, 6, false) then return false; end if;
      if not public.post_detail_int(b, 'score', 1, 15, true) then return false; end if;
    end if;
    return true;
  end if;

  if p_kind = 'hole' then
    return public.post_detail_int(d, 'hole', 1, 27, true)
       and public.post_detail_int(d, 'par', 3, 6, false)
       and public.post_detail_int(d, 'yards', 30, 800, false)
       and public.post_detail_int(d, 'score', 1, 15, false);
  end if;

  -- shot
  if not (d ? 'club' or d ? 'distance_yards' or d ? 'result') then return false; end if;
  if d ? 'lie' and not (jsonb_typeof(d->'lie') = 'string'
      and d->>'lie' = any(array['tee','fairway','rough','bunker','fringe','green','recovery'])) then return false; end if;
  return public.post_detail_int(d, 'hole', 1, 27, false)
     and public.post_detail_int(d, 'shot_number', 1, 15, false)
     and public.post_detail_text(d, 'club', 24)
     and public.post_detail_int(d, 'distance_yards', 1, 450, false)
     and public.post_detail_text(d, 'result', 40);
end;
$$;

-- Pure functions of their arguments; nobody needs to call them directly.
revoke all on function public.post_details_valid(text, jsonb) from public, anon;
revoke all on function public.post_detail_int(jsonb, text, int, int, boolean) from public, anon;
revoke all on function public.post_detail_text(jsonb, text, int) from public, anon;
grant execute on function public.post_details_valid(text, jsonb) to authenticated, service_role;
grant execute on function public.post_detail_int(jsonb, text, int, int, boolean) to authenticated, service_role;
grant execute on function public.post_detail_text(jsonb, text, int) to authenticated, service_role;


-- ============ the columns ============

alter table public.posts
  add column if not exists kind text not null default 'general'
    check (kind in ('general', 'round', 'hole', 'shot')),
  add column if not exists details jsonb;

alter table public.posts drop constraint if exists posts_details_valid;
alter table public.posts
  add constraint posts_details_valid check (public.post_details_valid(kind, details));

-- A member writes kind and details when they post (0088's column grants plus
-- these two). Not on UPDATE: a post doesn't change kind, and editing the
-- details of a shared round can come later with caption editing.
grant insert (author_id, body, visibility, club_id, kind, details) on public.posts to authenticated;
