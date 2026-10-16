-- 0158_live_round_follows.sql — "Follow my round" (Oct 2026).
--
-- A player shares their scorecard, live, with someone who isn't playing: a
-- parent at home, a friend at work. Two ways:
--
--   * to a PinPal  — follower_id is set. It opens in their app (Live scoring →
--                    Following, and their Home Screen widget) and they're told
--                    when it starts, on a birdie or better, and at the finish.
--   * as a link    — token_hash is set. Anyone with the link sees the card in
--                    a browser, no account needed. The link carries a random
--                    secret; only its SHA-256 is stored here, so a database
--                    read can't rebuild a working link, and stopping it is
--                    final.
--
-- WHAT A FOLLOWER SEES
--
--   One card: the shared player's (or, in a scramble or foursomes, their
--   side's) holes, scores and running total, plus where they stand in the
--   game as a place ("2nd of 4") — never the other players' names or cards.
--   Those people didn't share anything. Built server-side by
--   src/lib/follow-card.ts with the service role, after the website has
--   checked the link or (for a PinPal) read this row under RLS.
--
-- WHO MAY SHARE
--
--   * any member, their OWN card;
--   * whoever started the round (or organised its match day), a GUEST's card
--     — so an adult scoring for a junior guest can send the parent the link.
--     PinPals is 18+, so a junior plays as a guest.
--   Never another member's card: they share their own.
--
-- WHO MAY STOP IT
--
--   Whoever shared it, the member whose card it is, and the follower (to stop
--   following). Every share also lapses by itself 18 hours after it was made,
--   so nothing lingers after the round. Deleting the round, or the player,
--   removes its shares (cascade).
--
-- Writes only through live_follow_share() and live_follow_stop(). Members can
-- read the rows they shared or follow; nobody else, and anon never.
--
-- A GUEST'S CARD THAT BECOMES A MEMBER'S
--
--   If a guest later claims their seat (claim_round_guest, 0118), shares of
--   that card made by someone else stop at once: from then on it's a
--   member's card, and members share their own.
--
-- Rollback:
--   drop trigger if exists live_round_player_claimed_stops_follows on public.live_round_players;
--   drop function if exists public.live_round_player_claimed_stops_follows();
--   drop function if exists public.live_follow_share(bigint, uuid[], text);
--   drop function if exists public.live_follow_stop(bigint);
--   drop table if exists public.live_round_follows;

create table public.live_round_follows (
  id bigint generated always as identity primary key,
  round_id bigint not null references public.live_rounds (id) on delete cascade,
  player_id bigint not null references public.live_round_players (id) on delete cascade,
  shared_by uuid not null references public.profiles (id) on delete cascade,
  follower_id uuid references public.profiles (id) on delete cascade,
  token_hash text unique check (token_hash is null or token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  -- Exactly one of: a PinPal, or a link.
  constraint live_round_follows_one_kind check ((follower_id is null) <> (token_hash is null))
);

create index live_round_follows_player_idx on public.live_round_follows (player_id);
create index live_round_follows_round_idx on public.live_round_follows (round_id);
create index live_round_follows_follower_idx on public.live_round_follows (follower_id, expires_at desc)
  where follower_id is not null;
create index live_round_follows_shared_by_idx on public.live_round_follows (shared_by);
-- One row per PinPal per card: sharing again renews it.
create unique index live_round_follows_one_per_pinpal on public.live_round_follows (player_id, follower_id)
  where follower_id is not null;

comment on table public.live_round_follows is
  'Follow my round (0158): a player''s live card shared with a PinPal (follower_id) or as a link (token_hash = sha256 of the secret in the link). Written only via live_follow_share() / live_follow_stop().';

alter table public.live_round_follows enable row level security;

-- ...and the member whose card it is, so they can always see (and stop)
-- who is following them, whoever shared it.
create policy "Members read the shares they made or follow" on public.live_round_follows
  for select to authenticated
  using (
    shared_by = (select auth.uid())
    or follower_id = (select auth.uid())
    or exists (
      select 1 from public.live_round_players p
       where p.id = live_round_follows.player_id and p.member_id = (select auth.uid())
    )
  );

revoke all on public.live_round_follows from anon, authenticated;
grant select on public.live_round_follows to authenticated;

-- ---------------------------------------------------------------------------
-- live_follow_share(player, followers, token_hash) → [{ id, follower_id }]
--
-- Pass PinPals in p_followers, or a link's hash in p_token_hash, or both.
-- A PinPal who already follows this card has their share renewed (no
-- second row, and no second alert: the website dedupes on the row id).
-- ---------------------------------------------------------------------------
create or replace function public.live_follow_share(
  p_player_id bigint,
  p_followers uuid[] default null,
  p_token_hash text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_player public.live_round_players%rowtype;
  v_round public.live_rounds%rowtype;
  v_organiser uuid;
  v_follower uuid;
  v_id bigint;
  v_expires timestamptz := now() + interval '18 hours';
  v_out jsonb := '[]'::jsonb;
  v_count int;
begin
  if v_me is null then
    raise exception 'Sign in to share your round' using errcode = '42501';
  end if;

  select * into v_player from public.live_round_players where id = p_player_id;
  if not found then
    raise exception 'No such player' using errcode = '22023';
  end if;
  select * into v_round from public.live_rounds where id = v_player.round_id;
  if v_round.status <> 'live' then
    raise exception 'This round has finished' using errcode = 'P0001';
  end if;
  select d.created_by into v_organiser from public.live_match_days d where d.id = v_round.match_day_id;

  -- Your own card; or, if you started the round (or organised its day), a
  -- guest's. Never another member's.
  -- (IS NOT DISTINCT FROM, not =: a guest has no member and a round may have
  -- no organiser, and a NULL here would let the check fall through.)
  if not coalesce(
    v_player.member_id is not distinct from v_me
    or (v_player.member_id is null
        and (v_round.created_by is not distinct from v_me or v_organiser is not distinct from v_me)),
    false
  ) then
    raise exception 'You can share your own card, or a guest''s in a round you started' using errcode = '42501';
  end if;

  if coalesce(cardinality(p_followers), 0) = 0 and p_token_hash is null then
    raise exception 'Choose a PinPal or a link' using errcode = '22023';
  end if;
  if coalesce(cardinality(p_followers), 0) > 10 then
    raise exception 'Share with up to 10 PinPals at a time' using errcode = '22023';
  end if;

  -- PinPals: accepted, not blocked either way, not deleted, not yourself.
  if p_followers is not null then
    foreach v_follower in array p_followers loop
      if v_follower is null or v_follower = v_me then
        continue;
      end if;
      if not exists (select 1 from public.profiles where id = v_follower and deleted_at is null)
         or public.is_blocked(v_me, v_follower)
         or not exists (
           select 1 from public.connections c
            where c.status = 'accepted'
              and least(c.requester_id, c.recipient_id) = least(v_me, v_follower)
              and greatest(c.requester_id, c.recipient_id) = greatest(v_me, v_follower)
         ) then
        raise exception 'You can share with your PinPals' using errcode = '42501';
      end if;

      select id into v_id from public.live_round_follows
       where player_id = p_player_id and follower_id = v_follower
       order by id desc limit 1;
      if v_id is not null then
        update public.live_round_follows
           set revoked_at = null, expires_at = v_expires, shared_by = v_me
         where id = v_id;
      else
        insert into public.live_round_follows (round_id, player_id, shared_by, follower_id, expires_at)
        values (v_round.id, p_player_id, v_me, v_follower, v_expires)
        returning id into v_id;
      end if;
      v_out := v_out || jsonb_build_object('id', v_id, 'follower_id', v_follower);
      v_id := null;
    end loop;

    select count(*) into v_count from public.live_round_follows
     where player_id = p_player_id and follower_id is not null and revoked_at is null and expires_at > now();
    if v_count > 20 then
      raise exception 'A card can be followed by up to 20 PinPals' using errcode = '22023';
    end if;
  end if;

  if p_token_hash is not null then
    if p_token_hash !~ '^[0-9a-f]{64}$' then
      raise exception 'Bad link' using errcode = '22023';
    end if;
    select count(*) into v_count from public.live_round_follows
     where player_id = p_player_id and token_hash is not null and revoked_at is null and expires_at > now();
    if v_count >= 5 then
      raise exception 'This card already has 5 links. Stop one first.' using errcode = '22023';
    end if;
    insert into public.live_round_follows (round_id, player_id, shared_by, token_hash, expires_at)
    values (v_round.id, p_player_id, v_me, p_token_hash, v_expires)
    returning id into v_id;
    v_out := v_out || jsonb_build_object('id', v_id, 'follower_id', null);
  end if;

  return v_out;
end;
$$;

revoke all on function public.live_follow_share(bigint, uuid[], text) from public;
revoke execute on function public.live_follow_share(bigint, uuid[], text) from anon;
grant execute on function public.live_follow_share(bigint, uuid[], text) to authenticated;

-- ---------------------------------------------------------------------------
-- live_follow_stop(id): whoever shared it, the member whose card it is, or
-- the follower. Final: a stopped link never works again.
-- ---------------------------------------------------------------------------
create or replace function public.live_follow_stop(p_follow_id bigint)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
begin
  if v_me is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  update public.live_round_follows f
     set revoked_at = coalesce(f.revoked_at, now())
   where f.id = p_follow_id
     and (
       f.shared_by = v_me
       or f.follower_id = v_me
       or exists (select 1 from public.live_round_players p where p.id = f.player_id and p.member_id = v_me)
     );
  if not found then
    raise exception 'Not yours to stop' using errcode = '42501';
  end if;
  return true;
end;
$$;

revoke all on function public.live_follow_stop(bigint) from public;
revoke execute on function public.live_follow_stop(bigint) from anon;
grant execute on function public.live_follow_stop(bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- A guest's seat claimed by a member: other people's shares of it stop.
-- ---------------------------------------------------------------------------
create or replace function public.live_round_player_claimed_stops_follows()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.member_id is null and new.member_id is not null then
    update public.live_round_follows
       set revoked_at = coalesce(revoked_at, now())
     where player_id = new.id and shared_by <> new.member_id;
  end if;
  return new;
end;
$$;

revoke all on function public.live_round_player_claimed_stops_follows() from public, anon, authenticated;

create trigger live_round_player_claimed_stops_follows
  after update of member_id on public.live_round_players
  for each row execute function public.live_round_player_claimed_stops_follows();
