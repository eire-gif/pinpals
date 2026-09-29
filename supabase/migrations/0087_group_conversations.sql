-- ============================================================================
-- A conversation can have more than two people in it
-- ============================================================================
--
-- 0043's header says it plainly: "a separate members join table would only be
-- needed for group conversations, which nothing in this schema requires."
-- Something now does.
--
-- WHAT WAS IN THE WAY. `conversations` was not merely two-party by
-- convention; it was two-party in eight separate places. Two `not null` uuid
-- columns and a not-self check. Two unique indexes on the sorted pair. Four
-- per-side cursor columns. Every policy on `conversations` and `messages`
-- written as `user_a_id = uid or user_b_id = uid`. A tampering trigger whose
-- entire job was "you may move your own two columns and not the other side's".
-- Three unread functions with the same two-column CASE. And the realtime
-- broadcast policy.
--
-- THE SHAPE THIS TAKES. `conversation_members` becomes the one authoritative
-- answer to "is this person in this conversation", for group AND direct
-- threads alike, and every policy below asks it and nothing else. That is the
-- whole point: ONE way to be a participant. The obvious cheaper migration —
-- keep the pair columns for direct threads, add a members table only for
-- groups — would have left every policy with a two-branch condition, and two
-- ways to be a participant on the most privacy-sensitive table in this app is
-- exactly the shape that drifts apart. 0083 exists because two unread
-- counters drifted apart; that lesson is cheaper to reuse than to relearn.
--
-- WHAT THE PAIR COLUMNS ARE STILL FOR. They stay, nullable, on direct
-- conversations only, and they no longer decide anything about access. Their
-- one remaining job is the uniqueness rule — "one direct thread per pair, per
-- listing" — which the unique indexes express and which a members table
-- cannot express without a synthesised key. Keeping them also means
-- startConversation(), /api/app/conversations and linkConversationToOrder()
-- carry on working untouched: a trigger below fills in the two member rows.
--
-- THE READ CURSORS DO MOVE, and they have to. last_read_at and archived_at
-- now live on `conversation_members` and the four columns are dropped. Had
-- they stayed, a direct thread would have had its read state in two places
-- and a group in one. There is no version of that which does not eventually
-- disagree with itself.
--
-- BLOCKING WINS, and this is a real trade-off rather than an oversight. If
-- anyone in a conversation has blocked you — or you them — you cannot post to
-- it, group or not. Today blocking is absolute, because today every thread is
-- two people; preserving that is the safer default, and the alternative
-- (blocking governs direct contact only, and a blocked member's posts are
-- merely hidden) would mean someone you blocked specifically so as not to
-- hear from them could still appear in a room you are in. The cost is that
-- one member can silence another in a shared group by blocking them. That
-- errs toward the person who pressed block, which is the right way to err.
-- Group creation refuses outright if any pair is blocked, so this is normally
-- caught at the door rather than discovered mid-conversation.
--
-- Rollback is NOT a one-liner — the cursor columns carry live data. Restore
-- from a snapshot rather than trying to unpick this by hand.


-- ============ CONVERSATIONS: what kind, and what it is called ============

alter table public.conversations
  add column if not exists kind text not null default 'direct',
  add column if not exists title text,
  add column if not exists created_by uuid references public.profiles (id) on delete set null;

alter table public.conversations drop constraint if exists conversations_kind_check;
alter table public.conversations
  add constraint conversations_kind_check check (kind in ('direct', 'group'));

alter table public.conversations drop constraint if exists conversations_title_length_check;
alter table public.conversations
  add constraint conversations_title_length_check
  check (title is null or char_length(trim(both from title)) between 1 and 80);

-- The pair columns describe a direct thread and only a direct thread.
alter table public.conversations alter column user_a_id drop not null;
alter table public.conversations alter column user_b_id drop not null;

alter table public.conversations drop constraint if exists conversations_shape_check;
alter table public.conversations
  add constraint conversations_shape_check check (
    case kind
      -- A direct thread is still exactly a pair, and still carries no title:
      -- it is named after whoever you are talking to.
      when 'direct' then user_a_id is not null and user_b_id is not null and title is null
      -- A group is named, and is described by its members rather than by two
      -- columns. Leaving the pair columns null is what keeps the unique
      -- indexes below from ever considering it.
      else user_a_id is null and user_b_id is null and title is not null
    end
  );

-- Uniqueness is a direct-thread rule. Spelled out in the predicate rather
-- than left to rely on NULLS DISTINCT doing the right thing for groups —
-- correct either way, but this says why.
drop index if exists conversations_member_pair_no_listing_idx;
drop index if exists conversations_member_pair_listing_idx;

create unique index conversations_member_pair_no_listing_idx
  on public.conversations (least(user_a_id, user_b_id), greatest(user_a_id, user_b_id))
  where kind = 'direct' and listing_id is null;

create unique index conversations_member_pair_listing_idx
  on public.conversations (least(user_a_id, user_b_id), greatest(user_a_id, user_b_id), listing_id)
  where kind = 'direct' and listing_id is not null;


-- ============ CONVERSATION_MEMBERS ============
--
-- The one authoritative participant list. Every policy in this migration
-- asks this table and nothing else.
create table if not exists public.conversation_members (
  conversation_id bigint not null references public.conversations (id) on delete cascade,
  member_id uuid not null references public.profiles (id) on delete cascade,
  -- Only groups have an owner, and only the owner may add people or rename
  -- the thread. Direct threads have two 'member' rows and no owner, because
  -- there is nothing for an owner of a two-person thread to decide.
  role text not null default 'member' check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  -- Moved here from conversations' four per-side columns. Same meaning:
  -- messages after this instant are unread for this member; archived_at
  -- hides the thread from this member's inbox and nobody else's.
  last_read_at timestamptz,
  archived_at timestamptz,
  primary key (conversation_id, member_id)
);

-- "Which conversations am I in" is the inbox's own query, and it reads this
-- the other way round from the primary key.
create index if not exists conversation_members_member_idx
  on public.conversation_members (member_id);

alter table public.conversation_members enable row level security;


-- ============ Backfill, before anything starts depending on it ============
--
-- Two rows per existing conversation, carrying each side's cursors across.
--
-- WHY THIS IS A DO BLOCK RATHER THAN TWO INSERTS. The four cursor columns are
-- dropped at the end of this file, so on a SECOND run they are already gone
-- and a plain `select c.user_a_last_read_at` fails to parse — leaving a
-- migration that cannot be re-run after a partial failure, which is exactly
-- when re-running it is the only thing anyone wants to do. Checking the
-- catalogue and using dynamic SQL is what makes the statement's mere
-- existence conditional rather than just its execution.
--
-- `on conflict do nothing` throughout, so a re-run adds what is missing and
-- disturbs nothing that is already there — a member's cursor must never be
-- reset to whatever the (now absent) column used to say.
do $backfill$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'conversations'
      and column_name = 'user_a_last_read_at'
  ) then
    -- First run: carry the cursors across.
    execute $q$
      insert into public.conversation_members
        (conversation_id, member_id, role, joined_at, last_read_at, archived_at)
      select c.id, c.user_a_id, 'member', c.created_at, c.user_a_last_read_at, c.user_a_archived_at
      from public.conversations c
      where c.user_a_id is not null
      on conflict do nothing
    $q$;

    execute $q$
      insert into public.conversation_members
        (conversation_id, member_id, role, joined_at, last_read_at, archived_at)
      select c.id, c.user_b_id, 'member', c.created_at, c.user_b_last_read_at, c.user_b_archived_at
      from public.conversations c
      where c.user_b_id is not null
      on conflict do nothing
    $q$;
  else
    -- A previous run already dropped the columns. There is nothing left to
    -- carry, but a direct conversation created between the two runs still
    -- needs its member rows, and without them its own participants cannot
    -- read it.
    insert into public.conversation_members (conversation_id, member_id, joined_at)
    select c.id, c.user_a_id, c.created_at
    from public.conversations c
    where c.user_a_id is not null
    on conflict do nothing;

    insert into public.conversation_members (conversation_id, member_id, joined_at)
    select c.id, c.user_b_id, c.created_at
    from public.conversations c
    where c.user_b_id is not null
    on conflict do nothing;
  end if;
end
$backfill$;


-- ============ A direct conversation still fills its own member rows ============
--
-- This is what lets startConversation(), /api/app/conversations and the RLS
-- fixtures keep inserting a conversation exactly as they always have. Without
-- it every insert site would have to learn about a second table, and one that
-- forgot would create a thread its own participants could not read.
--
-- Groups do not come through here: create_group_conversation() below writes
-- the conversation and its members in one statement each, inside one
-- transaction, because a group's membership is not derivable from the row.
create or replace function public.add_direct_conversation_members()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.kind = 'direct' then
    insert into public.conversation_members (conversation_id, member_id, joined_at)
    values (new.id, new.user_a_id, new.created_at), (new.id, new.user_b_id, new.created_at)
    on conflict do nothing;
  end if;
  return new;
end;
$$;

revoke all on function public.add_direct_conversation_members() from public, anon, authenticated;

drop trigger if exists conversations_add_direct_members on public.conversations;
create trigger conversations_add_direct_members
  after insert on public.conversations
  for each row
  execute function public.add_direct_conversation_members();


-- ============ Membership, as a function policies can call ============
--
-- SECURITY DEFINER for the same reason is_staff() and can_message() are: it
-- is called from inside policies on conversation_members itself, and a
-- policy that queried that table directly would recurse. Returns a boolean
-- and never row data.
create or replace function public.is_conversation_member(p_conversation_id bigint, p_user_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.conversation_members m
    where m.conversation_id = p_conversation_id
      and m.member_id = p_user_id
  );
$$;

revoke all on function public.is_conversation_member(bigint, uuid) from public, anon;
grant execute on function public.is_conversation_member(bigint, uuid) to authenticated;

/** True when anyone else in this conversation is blocked with `p_user_id`, in
 *  either direction. The send policy's gate — see the header on why blocking
 *  is absolute here. */
create or replace function public.conversation_has_block(p_conversation_id bigint, p_user_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.conversation_members m
    where m.conversation_id = p_conversation_id
      and m.member_id <> p_user_id
      and public.is_blocked(p_user_id, m.member_id)
  );
$$;

revoke all on function public.conversation_has_block(bigint, uuid) from public, anon;
grant execute on function public.conversation_has_block(bigint, uuid) to authenticated;


-- ============ CONVERSATION_MEMBERS: policies ============

-- You can see who else is in a conversation you are in — a group is
-- unusable otherwise, and for a direct thread it is the person you are
-- already talking to.
drop policy if exists "members see who is in their conversations" on public.conversation_members;
create policy "members see who is in their conversations"
  on public.conversation_members for select
  to authenticated
  using (public.is_conversation_member(conversation_id, (select auth.uid())));

-- Moving your own read cursor or archiving your own copy. Which columns may
-- move is the trigger's job, not this policy's — RLS cannot express "only
-- these columns" (the same limitation 0045 and 0049 both document).
drop policy if exists "members update their own read and archive state" on public.conversation_members;
create policy "members update their own read and archive state"
  on public.conversation_members for update
  to authenticated
  using (member_id = (select auth.uid()))
  with check (member_id = (select auth.uid()));

-- Leaving a group. Only your own row, and only from a group: walking out of
-- a two-person conversation is what archiving is for, and letting someone
-- delete their side of a direct thread would leave the other person talking
-- to a row that can no longer read them.
drop policy if exists "members leave a group" on public.conversation_members;
create policy "members leave a group"
  on public.conversation_members for delete
  to authenticated
  using (
    member_id = (select auth.uid())
    and exists (
      select 1 from public.conversations c
      where c.id = conversation_members.conversation_id and c.kind = 'group'
    )
  );

-- No INSERT policy at all. Membership is granted by
-- create_group_conversation() and add_conversation_member() below, both
-- SECURITY DEFINER, both of which check eligibility first. A member who
-- could insert here would be adding themselves to other people's
-- conversations, which is the whole boundary.
grant select, update, delete on public.conversation_members to authenticated;
revoke insert, truncate, references, trigger on public.conversation_members from authenticated;
revoke all on public.conversation_members from anon;

create or replace function public.prevent_conversation_member_tampering()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- A privileged caller (service role, or one of this file's own SECURITY
  -- DEFINER functions, which run nested and so at depth > 1) may write
  -- anything. Staff are NOT included: they have no access to message content
  -- anywhere, and membership is a fact about a conversation's contents.
  if auth.uid() is null or pg_trigger_depth() > 1 then
    return new;
  end if;

  if new.conversation_id is distinct from old.conversation_id
    or new.member_id is distinct from old.member_id
    or new.role is distinct from old.role
    or new.joined_at is distinct from old.joined_at
  then
    raise exception 'Only your own read and archive state may be updated';
  end if;

  return new;
end;
$$;

revoke all on function public.prevent_conversation_member_tampering() from public, anon, authenticated;

drop trigger if exists conversation_members_prevent_tampering on public.conversation_members;
create trigger conversation_members_prevent_tampering
  before update on public.conversation_members
  for each row
  execute function public.prevent_conversation_member_tampering();


-- ============ CONVERSATIONS: policies, rewritten ============

-- THE SECOND CLAUSE HERE IS LOAD-BEARING AND IS NOT A LEFTOVER. Read this
-- before deleting it in the name of "one source of truth".
--
-- `insert ... returning` re-checks the SELECT policy against the row it is
-- about to hand back, and it does so BEFORE the statement's AFTER ROW
-- triggers fire. add_direct_conversation_members() is an AFTER ROW trigger.
-- So on the inserting statement there are, for one moment, no member rows
-- yet, is_conversation_member() is false, and Postgres reports it as "new row
-- violates row-level security policy" — which looks exactly like a WITH CHECK
-- failure and is not one.
--
-- PostgREST issues RETURNING for every `.insert(...).select(...)`, which is
-- what startConversation() and /api/app/conversations both do. Without the
-- pair clause, starting any conversation at all fails in production.
--
-- It grants nothing extra. A group has both pair columns null, so the clause
-- is never true for one; a direct conversation's pair columns ARE its
-- membership, materialised into conversation_members by the same trigger. The
-- two are equivalent by construction, and this covers the instant before the
-- materialisation catches up.
drop policy if exists "Participants view their own conversations" on public.conversations;
create policy "Participants view their own conversations"
  on public.conversations for select
  to authenticated
  using (
    public.is_conversation_member(id, (select auth.uid()))
    or user_a_id = (select auth.uid())
    or user_b_id = (select auth.uid())
  );

-- Unchanged in meaning: you may start a direct conversation you are a party
-- to, with someone can_message() agrees you may talk to. A group cannot be
-- created this way at all — create_group_conversation() is the only door,
-- because a group with no members is not a thing and a client insert could
-- not create both atomically.
drop policy if exists "Members start eligible conversations" on public.conversations;
create policy "Members start eligible conversations"
  on public.conversations for insert
  to authenticated
  with check (
    kind = 'direct'
    and (user_a_id = (select auth.uid()) or user_b_id = (select auth.uid()))
    and public.can_message(user_a_id, user_b_id)
  );

-- The read/archive update policy is GONE, not rewritten: that state moved to
-- conversation_members. What is left is renaming a group, which only its
-- owner may do.
drop policy if exists "Participants update their own read/archive state" on public.conversations;
drop policy if exists "Group owners rename their group" on public.conversations;
create policy "Group owners rename their group"
  on public.conversations for update
  to authenticated
  using (
    kind = 'group'
    and exists (
      select 1 from public.conversation_members m
      where m.conversation_id = conversations.id
        and m.member_id = (select auth.uid())
        and m.role = 'owner'
    )
  )
  with check (kind = 'group');

create or replace function public.prevent_conversation_tampering()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Same three exemptions as before. pg_trigger_depth() > 1 is what still
  -- lets touch_conversation_last_message() (0025) bump last_message_at from
  -- inside the AFTER INSERT on messages: that is a nested write, this is a
  -- participant's own UPDATE at depth 1.
  if auth.uid() is null or public.is_staff() or pg_trigger_depth() > 1 then
    return new;
  end if;

  -- Everything except the title. Previously this had to also police which of
  -- four cursor columns the caller owned; those columns are gone, so the rule
  -- collapses to "a member may rename a group and change nothing else", and
  -- which members may do even that is the policy's job above.
  if new.user_a_id is distinct from old.user_a_id
    or new.user_b_id is distinct from old.user_b_id
    or new.kind is distinct from old.kind
    or new.listing_id is distinct from old.listing_id
    or new.order_id is distinct from old.order_id
    or new.created_by is distinct from old.created_by
    or new.last_message_at is distinct from old.last_message_at
    or new.created_at is distinct from old.created_at
  then
    raise exception 'Only a group title may be updated on a conversation';
  end if;

  return new;
end;
$$;

revoke all on function public.prevent_conversation_tampering() from public, anon, authenticated;


-- ============ MESSAGES: policies, rewritten ============

drop policy if exists "Participants view conversation messages" on public.messages;
create policy "Participants view conversation messages"
  on public.messages for select
  to authenticated
  using (public.is_conversation_member(messages.conversation_id, (select auth.uid())));

drop policy if exists "Participants send messages in their own conversations" on public.messages;
create policy "Participants send messages in their own conversations"
  on public.messages for insert
  to authenticated
  with check (
    sender_id = (select auth.uid())
    and public.is_conversation_member(messages.conversation_id, (select auth.uid()))
    and not public.conversation_has_block(messages.conversation_id, (select auth.uid()))
  );


-- ============ STORAGE: the photo policy follows membership too ============
-- 0086 wrote this against the pair columns. Same rule, one source.
drop policy if exists "conversation participants read message photos" on storage.objects;
create policy "conversation participants read message photos"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'message-images'
    and public.is_conversation_member(
      public.message_image_conversation_id(name),
      (select auth.uid())
    )
  );


-- ============ REALTIME: the broadcast policy follows membership too ============
drop policy if exists "Participants receive their conversation broadcasts" on realtime.messages;
create policy "Participants receive their conversation broadcasts"
on realtime.messages
for select
to authenticated
using (
  extension = 'broadcast'
  and public.is_conversation_member(
    public.realtime_conversation_id(topic),
    (select auth.uid())
  )
);


-- ============ The unread arithmetic, from one table ============
--
-- All three of these previously carried the same two-column CASE. They now
-- carry none: `conversation_members` has one row per member with that
-- member's own cursor on it, which is what the CASE was emulating.

create or replace function public.conversation_unread_counts()
returns table (conversation_id bigint, unread_count bigint)
language sql
security invoker
set search_path = public
stable
as $$
  select
    m.conversation_id,
    (
      select count(*) from public.messages msg
      where msg.conversation_id = m.conversation_id
        and msg.sender_id <> (select auth.uid())
        and msg.created_at > coalesce(m.last_read_at, '-infinity'::timestamptz)
    )
  from public.conversation_members m
  where m.member_id = (select auth.uid());
$$;

revoke all on function public.conversation_unread_counts() from public;
revoke execute on function public.conversation_unread_counts() from anon;
grant execute on function public.conversation_unread_counts() to authenticated;

create or replace function public.inbox_unread_counts()
returns table (message_count bigint, alert_count bigint)
language sql
security invoker
set search_path = public
stable
as $$
  select
    (
      select coalesce(count(*), 0)::bigint
      from public.conversation_members m
      join public.messages msg on msg.conversation_id = m.conversation_id
      where m.member_id = (select auth.uid())
        -- Archived threads stay out of the badge: a member who archived a
        -- thread said they were done with it, and a number they cannot see
        -- the source of is how a badge becomes something people ignore.
        and m.archived_at is null
        and msg.sender_id <> (select auth.uid())
        and msg.created_at > coalesce(m.last_read_at, '-infinity'::timestamptz)
    ),
    (
      select coalesce(count(*), 0)::bigint
      from public.notifications n
      where n.user_id = (select auth.uid())
        and n.read_at is null
        -- new_message is delivery-only: every message writes one so it can be
        -- emailed and pushed, and counting it here would count every message
        -- twice. See 0083.
        and n.type <> 'new_message'
    );
$$;

revoke all on function public.inbox_unread_counts() from public;
revoke execute on function public.inbox_unread_counts() from anon;
grant execute on function public.inbox_unread_counts() to authenticated;

-- Three statements became two, and the awkward one became ordinary: there is
-- no longer a "whichever of two columns is mine" to work around.
create or replace function public.mark_inbox_read()
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  me uuid := (select auth.uid());
  now_at timestamptz := now();
begin
  if me is null then
    raise exception 'mark_inbox_read() requires a signed-in caller';
  end if;

  update public.notifications
     set read_at = now_at
   where user_id = me
     and read_at is null;

  update public.conversation_members
     set last_read_at = now_at
   where member_id = me
     and archived_at is null;
end;
$$;

revoke all on function public.mark_inbox_read() from public;
revoke execute on function public.mark_inbox_read() from anon;
grant execute on function public.mark_inbox_read() to authenticated;


-- ============ Now the old columns can go ============
--
-- After the backfill and after every reader above stopped naming them. A
-- conversation's read state lives in exactly one place from here on.
alter table public.conversations
  drop column if exists user_a_last_read_at,
  drop column if exists user_b_last_read_at,
  drop column if exists user_a_archived_at,
  drop column if exists user_b_archived_at;


-- ============ Creating a group ============
--
-- An RPC rather than a route, which is the opposite of how this app usually
-- does writes — and the reason is atomicity. A group is a conversation row
-- plus N member rows, and a conversation that briefly exists with nobody in
-- it is a conversation nobody, including its creator, can read. There is no
-- way to do both from a client in one transaction.
--
-- The eligibility rules, in one place:
--   * the creator must be able to message every person they add
--     (can_message(): connected, mid-offer, or sharing an accepted tee-time
--     interest — the same gate a direct thread passes)
--   * no two people in the group may be blocked with each other, in either
--     direction. Checked across ALL pairs, not just against the creator:
--     otherwise A could put B and C in a room together when B blocked C.
--     O(n²) on a list capped at 20, against an indexed lookup.
--
-- The route in front of this still owns the rate limit and the friendly
-- wording, the same division as /api/app/conversations.
create or replace function public.create_group_conversation(p_title text, p_member_ids uuid[])
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := (select auth.uid());
  v_title text := trim(both from coalesce(p_title, ''));
  v_members uuid[];
  v_conversation_id bigint;
  a uuid;
  b uuid;
begin
  if me is null then
    raise exception 'You must be signed in to start a group.';
  end if;

  if char_length(v_title) = 0 then
    raise exception 'Give the group a name.';
  end if;
  if char_length(v_title) > 80 then
    raise exception 'That name is too long — 80 characters at most.';
  end if;

  -- The creator is always in it, and duplicates are the caller sending the
  -- same person twice rather than an error worth refusing over.
  select array_agg(distinct id) into v_members
  from unnest(coalesce(p_member_ids, '{}'::uuid[]) || me) as t(id)
  where id is not null;

  if array_length(v_members, 1) < 3 then
    -- Two people is a direct conversation, and there is already one of those
    -- for every pair. Making a second, differently-shaped thread for the same
    -- two people would split their history in half.
    raise exception 'A group needs at least two other people — message someone directly instead.';
  end if;
  if array_length(v_members, 1) > 20 then
    raise exception 'A group can hold 20 people at most.';
  end if;

  -- May the creator talk to each of them at all?
  foreach a in array v_members loop
    if a <> me and not public.can_message(me, a) then
      raise exception 'You can only add golfers you''re connected with.';
    end if;
  end loop;

  -- Is any pair blocked, in either direction?
  foreach a in array v_members loop
    foreach b in array v_members loop
      if a < b and public.is_blocked(a, b) then
        raise exception 'Someone in that list has blocked another — they can''t be in a group together.';
      end if;
    end loop;
  end loop;

  insert into public.conversations (kind, title, created_by)
  values ('group', v_title, me)
  returning id into v_conversation_id;

  insert into public.conversation_members (conversation_id, member_id, role)
  select v_conversation_id, id, case when id = me then 'owner' else 'member' end
  from unnest(v_members) as t(id);

  return v_conversation_id;
end;
$$;

revoke all on function public.create_group_conversation(text, uuid[]) from public;
revoke execute on function public.create_group_conversation(text, uuid[]) from anon;
grant execute on function public.create_group_conversation(text, uuid[]) to authenticated;


-- ============ Adding someone later ============
--
-- The owner only. Any-member-can-add is how a group ends up containing
-- someone nobody can account for, and an owner is the one person who can be
-- asked why.
--
-- `joined_at` is what the thread screen uses to show "X joined" in the right
-- place. It does NOT restrict what they can read: a new member sees the
-- history, as they do in every group chat anyone has used, and the owner is
-- expected to know that before adding someone to a thread about a dispute.
create or replace function public.add_conversation_member(p_conversation_id bigint, p_member_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := (select auth.uid());
  v_kind text;
  v_count integer;
  existing uuid;
begin
  if me is null then
    raise exception 'You must be signed in.';
  end if;

  select c.kind into v_kind from public.conversations c where c.id = p_conversation_id;
  if v_kind is null then
    raise exception 'That conversation no longer exists.';
  end if;
  if v_kind <> 'group' then
    raise exception 'People can only be added to a group.';
  end if;

  if not exists (
    select 1 from public.conversation_members m
    where m.conversation_id = p_conversation_id and m.member_id = me and m.role = 'owner'
  ) then
    raise exception 'Only whoever started the group can add people to it.';
  end if;

  if exists (
    select 1 from public.conversation_members m
    where m.conversation_id = p_conversation_id and m.member_id = p_member_id
  ) then
    -- Already in it. Not an error worth refusing over — the caller's list was
    -- simply out of date.
    return;
  end if;

  select count(*) into v_count
  from public.conversation_members m where m.conversation_id = p_conversation_id;
  if v_count >= 20 then
    raise exception 'A group can hold 20 people at most.';
  end if;

  if not public.can_message(me, p_member_id) then
    raise exception 'You can only add golfers you''re connected with.';
  end if;

  for existing in
    select m.member_id from public.conversation_members m
    where m.conversation_id = p_conversation_id
  loop
    if public.is_blocked(existing, p_member_id) then
      raise exception 'Someone in the group has blocked them — they can''t be added.';
    end if;
  end loop;

  insert into public.conversation_members (conversation_id, member_id)
  values (p_conversation_id, p_member_id);
end;
$$;

revoke all on function public.add_conversation_member(bigint, uuid) from public;
revoke execute on function public.add_conversation_member(bigint, uuid) from anon;
grant execute on function public.add_conversation_member(bigint, uuid) to authenticated;
