-- 0130_chat_reactions_replies.sql
--
-- The chat redesign (Oct 2026): the things members expect from WhatsApp.
--
--   * Reactions — long-press a message, tap 👍 ❤️ 😂 ⛳ 🔥 👏 or any emoji.
--     One reaction per member per message; tapping the same one takes it off.
--   * Replies — a message can quote an earlier one in the same thread.
--   * Reply privately — from a group, quote someone's message into your direct
--     thread with them. The quote is a SNAPSHOT taken when the reply is sent,
--     written by the trigger below from the real message, never by the client:
--     the person reading the private reply may have left the group and can no
--     longer read the original.
--   * Delete for me — hides a message from your own copy of the thread only.
--   * Delete for everyone — your own message, within 48 hours. The row stays
--     (a thread that silently loses a line reads as a bug), its words are
--     replaced with "This message was deleted" — which is also exactly what an
--     app or website too old to know about deleted_at shows — and the photo
--     path is cleared. The original words and path are kept in
--     message_deletions, readable by nobody but the service role, so a
--     message that was reported and then deleted can still be moderated.
--   * Typing — "Seán is typing…" travels on its own realtime topic,
--     `typing-<conversationId>`, the ONE topic members may publish on. It is
--     separate from `conversation-<id>` on purpose: a member publishing a
--     forged event there could only ever fake a typing indicator, never a
--     message, a reaction or a deletion.
--   * Live ticks and reactions — reactions, deletions and read cursors ping
--     `conversation-<id>` from the database (realtime.send, the 0103
--     pattern). Every ping means "re-fetch", never data to render.
--
-- "Reply privately" opens the direct thread through start_private_reply(),
-- which allows exactly that and nothing more — can_message() is unchanged
-- (widening it would chain through group invitations; see the function).
-- mark_conversation_read() sets the read cursor on the server's clock.
--
-- Rollback:
--   drop function if exists public.react_to_message(bigint, text);
--   drop function if exists public.hide_message_for_me(bigint);
--   drop function if exists public.delete_message_for_everyone(bigint);
--   drop trigger if exists messages_reply_snapshot on public.messages;
--   drop function if exists public.message_reply_snapshot();
--   drop trigger if exists messages_scrub_quotes on public.messages;
--   drop function if exists public.message_scrub_quotes();
--   drop trigger if exists conversation_members_read_ping on public.conversation_members;
--   drop function if exists public.conversation_read_ping();
--   drop policy if exists "Participants receive typing in their conversations" on realtime.messages;
--   drop policy if exists "Participants send typing in their conversations" on realtime.messages;
--   drop function if exists public.realtime_typing_conversation_id(text);
--   drop function if exists public.start_private_reply(bigint);
--   drop function if exists public.mark_conversation_read(bigint);
--   drop table if exists public.message_reactions, public.message_hides, public.message_deletions;
--   alter table public.messages drop column reply_to_id, drop column reply_snapshot, drop column deleted_at;

-- ============ messages: three new columns ============

alter table public.messages
  add column if not exists reply_to_id bigint references public.messages (id) on delete set null,
  add column if not exists reply_snapshot jsonb,
  add column if not exists deleted_at timestamptz;

create index if not exists messages_reply_to_idx on public.messages (reply_to_id) where reply_to_id is not null;

-- The quote, from the real message. Also the guard on the two columns a
-- sender must never set themselves: deleted_at and the snapshot.
create or replace function public.message_reply_snapshot()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  src record;
  v_group text := null;
begin
  new.deleted_at := null;
  new.reply_snapshot := null;
  if new.reply_to_id is null then
    return new;
  end if;

  select m.id, m.conversation_id, m.sender_id, m.body, m.image_path, m.hidden_at, m.deleted_at,
         c.kind, c.title
    into src
    from public.messages m
    join public.conversations c on c.id = m.conversation_id
   where m.id = new.reply_to_id;

  if not found or src.hidden_at is not null or src.deleted_at is not null then
    raise exception 'That message can''t be replied to.';
  end if;

  if src.conversation_id <> new.conversation_id then
    -- Reply privately: from a group you are in, to a direct thread with
    -- whoever wrote the message.
    if src.kind <> 'group'
       or src.sender_id = new.sender_id
       or not public.is_conversation_member(src.conversation_id, new.sender_id)
       or not exists (
         select 1 from public.conversations d
          where d.id = new.conversation_id
            and d.kind = 'direct'
            and src.sender_id in (d.user_a_id, d.user_b_id)
            and new.sender_id in (d.user_a_id, d.user_b_id)
       ) then
      raise exception 'That message can''t be replied to.';
    end if;
    v_group := coalesce(nullif(btrim(src.title), ''), 'a group');
  end if;

  new.reply_snapshot := jsonb_build_object(
    'sender_id', src.sender_id,
    'body', left(src.body, 280),
    'photo', src.image_path is not null,
    'group', v_group
  );
  return new;
end;
$$;
revoke all on function public.message_reply_snapshot() from public, anon, authenticated;

create trigger messages_reply_snapshot
  before insert on public.messages
  for each row execute function public.message_reply_snapshot();

-- A message moderators hide stops being quoted anywhere too.
create or replace function public.message_scrub_quotes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.hidden_at is not null and old.hidden_at is null then
    update public.messages
       set reply_snapshot = jsonb_build_object('removed', true)
     where reply_to_id = new.id;
  end if;
  return null;
end;
$$;
revoke all on function public.message_scrub_quotes() from public, anon, authenticated;

create trigger messages_scrub_quotes
  after update of hidden_at on public.messages
  for each row execute function public.message_scrub_quotes();

-- ============ Reactions ============

create table if not exists public.message_reactions (
  message_id bigint not null references public.messages (id) on delete cascade,
  member_id uuid not null references public.profiles (id) on delete cascade,
  conversation_id bigint not null references public.conversations (id) on delete cascade,
  emoji text not null check (char_length(emoji) between 1 and 16),
  created_at timestamptz not null default now(),
  primary key (message_id, member_id)
);

create index if not exists message_reactions_conversation_idx on public.message_reactions (conversation_id);
create index if not exists message_reactions_member_idx on public.message_reactions (member_id);

alter table public.message_reactions enable row level security;

create policy "members see reactions in their conversations"
  on public.message_reactions for select
  to authenticated
  using (public.is_conversation_member(conversation_id, (select auth.uid())));

revoke all on public.message_reactions from anon;
revoke insert, update, delete, truncate, references, trigger on public.message_reactions from authenticated;
grant select on public.message_reactions to authenticated;

-- Set, change or (with null / the same emoji again) take off your reaction.
-- Returns the reaction now in place, or null.
create or replace function public.react_to_message(p_message_id bigint, p_emoji text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := (select auth.uid());
  v_conv bigint;
  v_emoji text := nullif(btrim(coalesce(p_emoji, '')), '');
  v_current text;
begin
  if me is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;

  select m.conversation_id into v_conv
    from public.messages m
   where m.id = p_message_id
     and m.hidden_at is null
     and m.deleted_at is null;

  if v_conv is null or not public.is_conversation_member(v_conv, me) then
    raise exception 'That message isn''t available.' using errcode = '42501';
  end if;
  if public.conversation_has_block(v_conv, me) then
    raise exception 'You can''t react in this conversation.' using errcode = '42501';
  end if;

  select emoji into v_current from public.message_reactions where message_id = p_message_id and member_id = me;

  if v_emoji is null or v_emoji = v_current then
    delete from public.message_reactions where message_id = p_message_id and member_id = me;
    v_emoji := null;
  else
    if char_length(v_emoji) > 16 or v_emoji ~ '[\x01-\x7f\u0080-\u1fff\u2070-\u218f\u3040-\ua4cf\uac00-\ud7af]' then
      raise exception 'Choose an emoji.';
    end if;
    insert into public.message_reactions (message_id, member_id, conversation_id, emoji)
    values (p_message_id, me, v_conv, v_emoji)
    on conflict (message_id, member_id) do update set emoji = excluded.emoji, created_at = now();
  end if;

  begin
    perform realtime.send(
      jsonb_build_object('message_id', p_message_id, 'what', 'reaction'),
      'message_changed', 'conversation-' || v_conv, true);
  exception when others then
    null;
  end;

  return v_emoji;
end;
$$;
revoke all on function public.react_to_message(bigint, text) from public, anon, authenticated;
grant execute on function public.react_to_message(bigint, text) to authenticated;

-- ============ Delete for me ============

create table if not exists public.message_hides (
  member_id uuid not null references public.profiles (id) on delete cascade,
  message_id bigint not null references public.messages (id) on delete cascade,
  conversation_id bigint not null references public.conversations (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (member_id, message_id)
);

create index if not exists message_hides_conversation_idx on public.message_hides (member_id, conversation_id);

alter table public.message_hides enable row level security;

create policy "members see what they deleted for themselves"
  on public.message_hides for select
  to authenticated
  using (member_id = (select auth.uid()));

revoke all on public.message_hides from anon;
revoke insert, update, delete, truncate, references, trigger on public.message_hides from authenticated;
grant select on public.message_hides to authenticated;

create or replace function public.hide_message_for_me(p_message_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := (select auth.uid());
  v_conv bigint;
begin
  if me is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  select conversation_id into v_conv from public.messages where id = p_message_id;
  if v_conv is null or not public.is_conversation_member(v_conv, me) then
    raise exception 'That message isn''t available.' using errcode = '42501';
  end if;
  insert into public.message_hides (member_id, message_id, conversation_id)
  values (me, p_message_id, v_conv)
  on conflict do nothing;
end;
$$;
revoke all on function public.hide_message_for_me(bigint) from public, anon, authenticated;
grant execute on function public.hide_message_for_me(bigint) to authenticated;

-- ============ Delete for everyone ============

create table if not exists public.message_deletions (
  message_id bigint primary key references public.messages (id) on delete cascade,
  conversation_id bigint not null,
  sender_id uuid not null,
  body text not null,
  image_path text,
  sent_at timestamptz not null,
  deleted_at timestamptz not null default now()
);

alter table public.message_deletions enable row level security;
revoke all on public.message_deletions from anon, authenticated;

-- Returns the photo path the message had (or null), so the website route
-- that calls this can remove the file from Storage.
create or replace function public.delete_message_for_everyone(p_message_id bigint)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := (select auth.uid());
  m record;
begin
  if me is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;

  select * into m from public.messages where id = p_message_id for update;
  if not found or m.sender_id <> me or not public.is_conversation_member(m.conversation_id, me) then
    raise exception 'You can only delete your own messages for everyone.' using errcode = '42501';
  end if;
  if m.deleted_at is not null then
    return null;
  end if;
  if m.hidden_at is not null then
    raise exception 'That message has already been removed.';
  end if;
  if m.created_at < now() - interval '48 hours' then
    raise exception 'Messages can be deleted for everyone for 48 hours after sending. You can still delete it for yourself.';
  end if;

  insert into public.message_deletions (message_id, conversation_id, sender_id, body, image_path, sent_at)
  values (m.id, m.conversation_id, m.sender_id, m.body, m.image_path, m.created_at)
  on conflict (message_id) do nothing;

  update public.messages
     set body = 'This message was deleted',
         image_path = null,
         reply_snapshot = null,
         deleted_at = now()
   where id = p_message_id;

  update public.messages
     set reply_snapshot = jsonb_build_object('deleted', true)
   where reply_to_id = p_message_id;

  delete from public.message_reactions where message_id = p_message_id;

  begin
    perform realtime.send(
      jsonb_build_object('message_id', p_message_id, 'what', 'deleted'),
      'message_changed', 'conversation-' || m.conversation_id, true);
  exception when others then
    null;
  end;

  return m.image_path;
end;
$$;
revoke all on function public.delete_message_for_everyone(bigint) from public, anon, authenticated;
grant execute on function public.delete_message_for_everyone(bigint) to authenticated;

-- ============ Read ticks, live ============

create or replace function public.conversation_read_ping()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.last_read_at is distinct from old.last_read_at then
    begin
      perform realtime.send(
        jsonb_build_object('member_id', new.member_id, 'last_read_at', new.last_read_at),
        'read', 'conversation-' || new.conversation_id, true);
    exception when others then
      null;
    end;
  end if;
  return null;
end;
$$;
revoke all on function public.conversation_read_ping() from public, anon, authenticated;

create trigger conversation_members_read_ping
  after update of last_read_at on public.conversation_members
  for each row execute function public.conversation_read_ping();

-- ============ Typing: the one topic members publish on ============

create or replace function public.realtime_typing_conversation_id(topic text)
returns bigint
language sql
immutable
parallel safe
as $$
  select case
    when topic ~ '^typing-[0-9]{1,18}$'
    then substring(topic from 8)::bigint
    else null
  end;
$$;
revoke all on function public.realtime_typing_conversation_id(text) from public;
grant execute on function public.realtime_typing_conversation_id(text) to authenticated;

create policy "Participants receive typing in their conversations"
on realtime.messages
for select
to authenticated
using (
  extension = 'broadcast'
  and public.is_conversation_member(public.realtime_typing_conversation_id(topic), (select auth.uid()))
);

create policy "Participants send typing in their conversations"
on realtime.messages
for insert
to authenticated
with check (
  extension = 'broadcast'
  and public.is_conversation_member(public.realtime_typing_conversation_id(topic), (select auth.uid()))
);

-- ============ Reply privately: the direct thread to reply in ============
--
-- NOT a widening of can_message(). That gate also decides who may be ADDED to
-- a group, so "shares a group" there would chain: anyone who can message you
-- could put you in a group with a stranger, and the stranger could then
-- message you, add you to their own groups, and so on. Instead this one
-- function opens (or finds) the direct thread for ONE purpose: answering a
-- message, in a group you are both in right now, written by the other person.
create or replace function public.start_private_reply(p_message_id bigint)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := (select auth.uid());
  m record;
  v_a uuid;
  v_b uuid;
  v_id bigint;
begin
  if me is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;

  select msg.sender_id, msg.conversation_id, msg.hidden_at, msg.deleted_at, c.kind
    into m
    from public.messages msg
    join public.conversations c on c.id = msg.conversation_id
   where msg.id = p_message_id;

  if not found
     or m.kind <> 'group'
     or m.hidden_at is not null
     or m.deleted_at is not null
     or m.sender_id = me
     or not public.is_conversation_member(m.conversation_id, me)
     or not public.is_conversation_member(m.conversation_id, m.sender_id) then
    raise exception 'You can''t reply privately to that message.' using errcode = '42501';
  end if;
  if public.is_blocked(me, m.sender_id) then
    raise exception 'You can''t message this member.' using errcode = '42501';
  end if;

  v_a := least(me, m.sender_id);
  v_b := greatest(me, m.sender_id);

  select id into v_id
    from public.conversations
   where kind = 'direct' and listing_id is null
     and least(user_a_id, user_b_id) = v_a
     and greatest(user_a_id, user_b_id) = v_b;
  if v_id is not null then
    update public.conversation_members set archived_at = null
     where conversation_id = v_id and member_id = me;
    return v_id;
  end if;

  begin
    insert into public.conversations (user_a_id, user_b_id, listing_id)
    values (v_a, v_b, null)
    returning id into v_id;
  exception when unique_violation then
    select id into v_id
      from public.conversations
     where kind = 'direct' and listing_id is null
       and least(user_a_id, user_b_id) = v_a
       and greatest(user_a_id, user_b_id) = v_b;
  end;
  return v_id;
end;
$$;
revoke all on function public.start_private_reply(bigint) from public, anon, authenticated;
grant execute on function public.start_private_reply(bigint) to authenticated;

-- ============ Marking read on the database's clock ============
--
-- The ✓✓ compares a reader's cursor with the message's created_at, which is
-- the server's clock. A cursor from the phone's clock (the app's old
-- `new Date()`) a few seconds slow would never pass it. Invoker rights: the
-- existing own-row UPDATE policy is the whole permission.
create or replace function public.mark_conversation_read(p_conversation_id bigint)
returns void
language sql
security invoker
set search_path = public
as $$
  update public.conversation_members
     set last_read_at = now()
   where conversation_id = p_conversation_id
     and member_id = (select auth.uid());
$$;
revoke all on function public.mark_conversation_read(bigint) from public, anon;
grant execute on function public.mark_conversation_read(bigint) to authenticated;
