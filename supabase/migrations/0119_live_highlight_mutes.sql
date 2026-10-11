-- 0119: "Match notifications" off switch for birdie alerts (Oct 2026).
--
-- A player can turn off the birdie / eagle / albatross / hole-in-one alerts
-- for one game from its scoring screen. The game is the round, or for a
-- match day or scramble the whole day — one switch covers every match in it
-- (game_key 'round:<id>' or 'day:<id>').
--
-- Kept as a flag rather than deleting rows, so turning alerts back on is the
-- same upsert. Read your own rows only; written only through
-- live_highlight_set_muted(), which checks you can see the game. The website
-- (service role) reads it when sending alerts (src/lib/live-highlights.ts).

create table public.live_highlight_mutes (
  member_id uuid not null references auth.users (id) on delete cascade,
  game_key text not null check (game_key ~ '^(round|day):[0-9]+$'),
  muted boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (member_id, game_key)
);

comment on table public.live_highlight_mutes is
  'Per-member, per-game switch for birdie-or-better alerts. Written only via live_highlight_set_muted().';

create index live_highlight_mutes_game_idx on public.live_highlight_mutes (game_key) where muted;

alter table public.live_highlight_mutes enable row level security;

create policy "Members read their own alert switches" on public.live_highlight_mutes
  for select to authenticated using (member_id = (select auth.uid()));

-- No insert/update policies: writes go through the function below.

create or replace function public.live_highlight_set_muted(p_round_id bigint, p_muted boolean)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_day bigint;
  v_key text;
begin
  if v_me is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if not public.can_view_live_round(p_round_id) then
    raise exception 'Round not found' using errcode = '42501';
  end if;
  select match_day_id into v_day from public.live_rounds where id = p_round_id;
  v_key := case when v_day is null then 'round:' || p_round_id else 'day:' || v_day end;

  insert into public.live_highlight_mutes (member_id, game_key, muted, updated_at)
  values (v_me, v_key, coalesce(p_muted, true), now())
  on conflict (member_id, game_key) do update set muted = excluded.muted, updated_at = now();

  return v_key;
end;
$$;

revoke all on function public.live_highlight_set_muted(bigint, boolean) from public;
revoke execute on function public.live_highlight_set_muted(bigint, boolean) from anon;
grant execute on function public.live_highlight_set_muted(bigint, boolean) to authenticated;
