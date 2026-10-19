-- 0181: every Golf Buddies group and golf trip has its chat from the start,
-- and each member chooses how loudly that chat alerts them.
--
-- 1. The chat opens when the group is created, with just its creator in it.
--    0120 waited for three people because a 0087 group conversation needs
--    three when a member builds one by hand (two is a direct thread). A
--    group's chat is not built by hand: group_sync_chat() owns its
--    membership, so the "three" rule has nothing to protect here, and
--    waiting for it left new groups with no chat and a "starts once three of
--    you are in" hint instead.
--
-- 2. Members under 18 are left out of the chat, not refused. 0159's age
--    guard raises on any conversation_members insert for a minor, and the
--    sync runs inside the join, so a junior joining a crew with a chat would
--    otherwise have failed the join itself. They stay in the group and see
--    everything else it offers them; chat opens up at 18 (the next join or
--    leave in the group adds them, same as a block being lifted).
--
-- 3. conversation_members.alerts — 'all' (every message), 'key' (only when
--    someone @mentions you or replies to you; the group's own round, event,
--    payment and itinerary alerts are separate notification types and are
--    not affected), or 'none' (muted). Members change their own row
--    directly: 0087's tampering trigger only freezes conversation_id,
--    member_id, role and joined_at, so this column needs no function.
--    Read by messaging-server.ts when it decides who to notify.
--
-- 4. Trips with eight or more golfers default new chat members to 'key', so
--    a big trip doesn't buzz everyone's phone all day. Whoever set the trip up
--    (and anyone who joined while it was small) keeps 'all' unless they
--    change it.
--
-- 5. Backfill: every existing crew or trip with chat switched on and no
--    conversation yet gets one now.

alter table public.conversation_members
  add column if not exists alerts text not null default 'all'
    check (alerts in ('all', 'key', 'none'));

comment on column public.conversation_members.alerts is
  'Chat alerts for this member: all, key (@mentions and replies only), none (muted). See 0181.';


create or replace function public.group_sync_chat(p_group_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  g public.groups%rowtype;
  v_owner uuid;
  v_conversation bigint;
  r record;
begin
  select * into g from public.groups where id = p_group_id;
  if not found or not ('chat' = any (g.features)) then
    return;
  end if;

  v_conversation := g.conversation_id;
  if v_conversation is null then
    -- From the first member (0120 waited for three). The 20 cap is 0087's.
    if g.member_count < 1 or g.member_count > 20 then
      return;
    end if;
    select member_id into v_owner from public.group_members where group_id = p_group_id and role = 'owner';
    if v_owner is null or public.is_minor(v_owner) then
      return;
    end if;
    insert into public.conversations (kind, title, created_by)
    values ('group', g.name, v_owner)
    returning id into v_conversation;
    update public.groups set conversation_id = v_conversation where id = p_group_id;
  end if;

  delete from public.conversation_members cm
   where cm.conversation_id = v_conversation
     and not exists (
       select 1 from public.group_members m
       where m.group_id = p_group_id and m.member_id = cm.member_id
     );

  for r in
    select m.member_id, m.role from public.group_members m
    where m.group_id = p_group_id
      and not exists (
        select 1 from public.conversation_members cm
        where cm.conversation_id = v_conversation and cm.member_id = m.member_id
      )
    order by (m.role = 'owner') desc, m.joined_at
  loop
    -- Chat is 18+ (0159). Left out rather than refused: see the header.
    if public.is_minor(r.member_id) then
      continue;
    end if;
    if exists (
      select 1 from public.conversation_members cm
      where cm.conversation_id = v_conversation
        and public.is_blocked(cm.member_id, r.member_id)
    ) then
      continue;
    end if;
    insert into public.conversation_members (conversation_id, member_id, role, alerts)
    values (
      v_conversation,
      r.member_id,
      -- Only the chat's creator holds 0087's 'owner'; there is exactly one.
      case when not exists (
        select 1 from public.conversation_members cm
        where cm.conversation_id = v_conversation and cm.role = 'owner'
      ) and r.role = 'owner' then 'owner' else 'member' end,
      case when g.kind = 'trip' and g.member_count >= 8 then 'key' else 'all' end
    )
    on conflict do nothing;
  end loop;
end;
$$;
revoke all on function public.group_sync_chat(bigint) from public, anon, authenticated;


-- Backfill. Runs as the migration (auth.uid() is null), so 0159's age guard
-- lets the inserts through; is_minor() above keeps juniors out regardless.
do $$
declare
  r record;
begin
  for r in
    select id from public.groups
     where conversation_id is null
       and kind in ('crew', 'trip')
       and 'chat' = any (features)
       and hidden_at is null
  loop
    perform public.group_sync_chat(r.id);
  end loop;
end;
$$;
