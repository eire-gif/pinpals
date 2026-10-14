-- 0141 — Start live scoring from a tee time (Oct 2026, claude/tee-time-live-scoring.md)
--
-- A tee time's page now has "Start live scoring" for the host and anyone
-- confirmed on it, which opens a new round with the fourball already on it.
-- Those players are often not PinPals yet — a stranger who took an open
-- place — so live_can_add_player() (0121) would refuse them. This adds one
-- more yes: the two of you are on the same tee time (host or confirmed),
-- it isn't cancelled, and it's not more than a day in the past.
--
-- Additive and idempotent: create or replace of one function, same
-- signature, same grants. Everything 0121 allowed is still allowed.
--
-- ROLLBACK: re-run the live_can_add_player() definition from
-- 0121_group_rounds.sql.

create or replace function public.live_can_add_player(p_me uuid, p_member uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_me is not null and p_member is not null and (
    p_member = p_me
    or (
      exists (select 1 from public.profiles where id = p_member and deleted_at is null)
      and not public.is_blocked(p_me, p_member)
      and (
        public.are_connected(p_me, p_member)
        or exists (
          select 1
            from public.group_members mine
            join public.group_members theirs
              on theirs.group_id = mine.group_id and theirs.member_id = p_member
            join public.groups g
              on g.id = mine.group_id and g.hidden_at is null
           where mine.member_id = p_me
             and (g.kind in ('crew', 'trip') or mine.role in ('owner', 'admin'))
        )
        -- New (0141): playing on the same tee time.
        or exists (
          select 1
            from public.tee_time_invites t
           where t.status <> 'cancelled'
             and t.play_date >= current_date - 1
             and (t.member_id = p_me
                  or exists (select 1 from public.tee_time_interests i
                              where i.invite_id = t.id and i.member_id = p_me and i.status = 'confirmed'))
             and (t.member_id = p_member
                  or exists (select 1 from public.tee_time_interests i
                              where i.invite_id = t.id and i.member_id = p_member and i.status = 'confirmed'))
        )
      )
    )
  );
$$;
revoke all on function public.live_can_add_player(uuid, uuid) from public, anon, authenticated;
