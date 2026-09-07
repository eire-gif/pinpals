-- Wires the marketplace up to the existing member-to-member messaging system
-- (0025_messaging.sql, extended with a listing link by
-- 0043_conversations_marketplace_context.sql) rather than building a second
-- one. 0043 only ever added the column — nothing in the app read or wrote
-- `conversations.listing_id` until this migration + its companion app-code
-- changes.
--
-- Design decisions:
--
--   * "One conversation per buyer/seller/listing context" is a REAL change
--     to 0025's own uniqueness rule, not just a new column. Today's
--     `conversations_member_pair_idx` is unconditionally unique per
--     unordered (user_a_id, user_b_id) pair — so a buyer messaging the same
--     seller about two different listings would today collide into one
--     conversation, silently mixing two unrelated negotiations in one
--     thread. Replaced below with two partial unique indexes: one per pair
--     with no listing (the existing connections/tee-time use case, unique
--     exactly as before) and one per (pair, listing) (the new marketplace
--     use case — the same two members get a fresh conversation per listing
--     they talk about). A pair can now have at most one listing-less
--     conversation plus at most one conversation per distinct listing.
--
--   * "An order link after purchase" is `conversations.order_id`
--     (nullable, `on delete set null` — matches the existing "drill-through
--     convenience link only" convention: orders.listing_id, disputes.order_id,
--     0043's own listing_id). Nothing here writes it — see
--     linkConversationToOrder() in src/lib/conversations-server.ts, called
--     best-effort from buyNow() and offerAction()'s accept branch
--     (src/app/marketplace/[id]/actions.ts) once an order actually exists.
--     Deliberately best-effort/non-blocking, same "a secondary write failing
--     must never break the primary flow" discipline as every other
--     opportunistic write in this schema (offer_action()'s own order-write
--     comment, buyNow()'s "Best-effort courtesy" listing update) — a missed
--     link just means the thread doesn't show order context yet, never a
--     failed purchase.
--
--   * Read receipts and per-participant archiving reuse 0025's own
--     "conversations are strictly two-party, so there's no members table"
--     shape: `user_a_last_read_at`/`user_b_last_read_at` and
--     `user_a_archived_at`/`user_b_archived_at`, the same two-column-per-side
--     pattern `user_a_id`/`user_b_id` already established, rather than a
--     `conversation_reads` join table that would only ever have exactly two
--     rows per conversation. Writable by a participant, but ONLY their own
--     side and ONLY these four columns — enforced by
--     `prevent_conversation_tampering()` below, the exact same "RLS is
--     row-level, a trigger is what actually restricts which columns" shape
--     0045's `prevent_notification_tampering()` already uses for
--     notifications.read_at.
--
--   * Blocking is a new, small `blocked_users` table (this app had no block
--     concept anywhere before this) — directional (a blocks b doesn't imply
--     b blocks a), SECURITY DEFINER `is_blocked()` reads it regardless of
--     caller for the same reason `can_message()` is SECURITY DEFINER: it's
--     called from inside policies with two arbitrary user ids, and only
--     ever returns a boolean. Wired into two places: `can_message()` itself
--     (blocks starting a NEW conversation), and messages' own INSERT policy
--     (blocks sending into an EXISTING conversation once either side blocks
--     the other, mid-thread — can_message() alone wouldn't catch that,
--     since an existing conversation never re-runs its own insert check).
--
--   * "Never send card, bank or identity-verification data through
--     messages" is enforced at the DB layer (`validate_message_content()`
--     below), not just a client-side hint — the same "the trigger/RPC is
--     what's actually enforced" discipline as every other guardrail in this
--     schema. It's a heuristic, documented as such: a 13-19 digit run
--     (typical card-number grouping, spaces/dashes allowed between digits),
--     an IBAN-shaped token, or a verification-sounding word near a number
--     all get rejected. This can over-trigger (e.g. a long, unbroken
--     tracking or reference number) — accepted deliberately, given what
--     this rule is protecting against; a rejected sender can always
--     rephrase. src/lib/messaging.ts's `containsSensitiveData()` mirrors
--     this in JS for instant client-side feedback before the round-trip,
--     same "app-layer mirrors the DB's real rule for fast, friendly
--     feedback" split as every numeric limit elsewhere in this schema.
--
--   * Report-message needed no schema change at all — `reports.target_type`
--     has included 'message' since 0016_admin_reports.sql, specifically so
--     this day's app-code wiring wouldn't need a migration of its own.
--
--   * Realtime is additive, display-only, and deliberately NOT built as one
--     `postgres_changes` subscription per conversation row (the task's own
--     "avoid one subscription per row" instruction) — see
--     src/lib/realtime.ts and the client components in
--     src/app/conversations/**. Nothing here changes what's durable:
--     Postgres (via the ordinary insert + this migration's policies) is
--     still the only source of truth; a broadcast that never arrives just
--     means a page refresh is what shows the new message instead of it
--     appearing live.
--
-- Rollback:
--   drop trigger if exists messages_validate_content on public.messages;
--   drop function if exists public.validate_message_content();
--   drop trigger if exists conversations_prevent_tampering on public.conversations;
--   drop function if exists public.prevent_conversation_tampering();
--   drop policy if exists "Participants update their own read/archive state" on public.conversations;
--   revoke update on public.conversations from authenticated;
--   alter table public.conversations
--     drop column if exists order_id,
--     drop column if exists user_a_last_read_at,
--     drop column if exists user_b_last_read_at,
--     drop column if exists user_a_archived_at,
--     drop column if exists user_b_archived_at;
--   drop index if exists conversations_member_pair_no_listing_idx;
--   drop index if exists conversations_member_pair_listing_idx;
--   -- then re-create conversations_member_pair_idx as 0025 originally had it
--   drop function if exists public.is_blocked(uuid, uuid);
--   drop table if exists public.blocked_users cascade;
--   -- then re-run can_message() and the messages insert policy as 0025 had them

-- ============ BLOCKED_USERS ============
create table if not exists public.blocked_users (
  blocker_id uuid not null references public.profiles (id) on delete cascade,
  blocked_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint blocked_users_not_self check (blocker_id <> blocked_id)
);

-- Covers the reverse-direction half of is_blocked()'s lookup (has the OTHER
-- person blocked me) without a sequential scan.
create index if not exists blocked_users_blocked_id_idx on public.blocked_users (blocked_id);

alter table public.blocked_users enable row level security;

drop policy if exists "members view their own block list" on public.blocked_users;
create policy "members view their own block list"
  on public.blocked_users for select
  to authenticated
  using ((select auth.uid()) = blocker_id);

drop policy if exists "members block other members" on public.blocked_users;
create policy "members block other members"
  on public.blocked_users for insert
  to authenticated
  with check ((select auth.uid()) = blocker_id);

drop policy if exists "members unblock other members" on public.blocked_users;
create policy "members unblock other members"
  on public.blocked_users for delete
  to authenticated
  using ((select auth.uid()) = blocker_id);

revoke update, truncate, references, trigger on public.blocked_users from anon;
revoke update, truncate, references, trigger on public.blocked_users from authenticated;

-- SECURITY DEFINER so it reads both directions of the block relationship
-- regardless of who's asking — same reasoning as can_message() (0025):
-- called from inside RLS policies with two arbitrary user ids, and only
-- ever returns a boolean, never row data. Without this, the block list's
-- own "view only your own rows" policy would make the OTHER direction
-- (has the other person blocked me) invisible to a plain, non-definer query.
create or replace function public.is_blocked(a uuid, b uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.blocked_users
    where (blocker_id = a and blocked_id = b)
       or (blocker_id = b and blocked_id = a)
  );
$$;

revoke all on function public.is_blocked(uuid, uuid) from public;
revoke execute on function public.is_blocked(uuid, uuid) from anon;
grant execute on function public.is_blocked(uuid, uuid) to authenticated;

-- ============ CAN_MESSAGE(): add the blocking veto ============
create or replace function public.can_message(a uuid, b uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select
    a <> b
    and not public.is_blocked(a, b)
    and (
      exists (
        select 1 from public.connections c
        where c.status = 'accepted'
          and least(c.requester_id, c.recipient_id) = least(a, b)
          and greatest(c.requester_id, c.recipient_id) = greatest(a, b)
      )
      or exists (
        select 1
        from public.offers o
        join public.listings l on l.id = o.listing_id
        where (o.buyer_id = a and l.seller_id = b)
           or (o.buyer_id = b and l.seller_id = a)
      )
      or exists (
        select 1
        from public.tee_time_interests ti
        join public.tee_time_invites inv on inv.id = ti.invite_id
        where ti.status in ('accepted', 'confirmed')
          and (
            (ti.member_id = a and inv.member_id = b)
            or (ti.member_id = b and inv.member_id = a)
          )
      )
    );
$$;

-- ============ CONVERSATIONS: listing-scoped uniqueness ============
drop index if exists conversations_member_pair_idx;

create unique index if not exists conversations_member_pair_no_listing_idx
  on public.conversations (least(user_a_id, user_b_id), greatest(user_a_id, user_b_id))
  where listing_id is null;

create unique index if not exists conversations_member_pair_listing_idx
  on public.conversations (least(user_a_id, user_b_id), greatest(user_a_id, user_b_id), listing_id)
  where listing_id is not null;

-- ============ CONVERSATIONS: order link, read receipts, archiving ============
alter table public.conversations
  add column if not exists order_id bigint references public.orders (id) on delete set null,
  add column if not exists user_a_last_read_at timestamptz,
  add column if not exists user_b_last_read_at timestamptz,
  add column if not exists user_a_archived_at timestamptz,
  add column if not exists user_b_archived_at timestamptz;

create index if not exists conversations_order_id_idx on public.conversations (order_id);

-- A participant may update their OWN side's read/archive columns — which
-- side is enforced by the trigger below, not by two separate policies,
-- since RLS can't express "only these columns" on its own (same limit
-- 0045's prevent_notification_tampering() comment already spells out).
grant update on public.conversations to authenticated;

drop policy if exists "Participants update their own read/archive state" on public.conversations;
create policy "Participants update their own read/archive state"
  on public.conversations for update
  to authenticated
  using (user_a_id = (select auth.uid()) or user_b_id = (select auth.uid()))
  with check (user_a_id = (select auth.uid()) or user_b_id = (select auth.uid()));

create or replace function public.prevent_conversation_tampering()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- A privileged caller (service-role client — linkConversationToOrder(),
  -- or the seed/admin path), staff, or a write nested inside another
  -- trigger may write any column. That last case is what lets
  -- touch_conversation_last_message() (0025) keep working after this
  -- migration: sending a message is an ordinary participant-level INSERT,
  -- but the AFTER INSERT trigger it fires issues its own UPDATE on this
  -- row to bump last_message_at — pg_trigger_depth() > 1 is how this
  -- function tells "the system's own touch trigger did this" apart from
  -- "a participant issued a raw UPDATE trying to set last_message_at
  -- themselves" (depth 1, just this trigger). touch_conversation_last_message()
  -- only ever sets that one column, so trusting anything it does here is safe.
  if auth.uid() is null or public.is_staff() or pg_trigger_depth() > 1 then
    return new;
  end if;

  -- Never touchable by a participant at all, regardless of which side
  -- they're on.
  if new.user_a_id is distinct from old.user_a_id
    or new.user_b_id is distinct from old.user_b_id
    or new.listing_id is distinct from old.listing_id
    or new.order_id is distinct from old.order_id
    or new.last_message_at is distinct from old.last_message_at
    or new.created_at is distinct from old.created_at
  then
    raise exception 'Only read/archive state may be updated on a conversation';
  end if;

  -- user_a may only move their own two columns; user_b's stay untouched by
  -- user_a, and vice versa — this is the "only YOUR side" half of the rule
  -- RLS's row-level using()/with check() can't express on its own.
  if (select auth.uid()) = old.user_a_id then
    if new.user_b_last_read_at is distinct from old.user_b_last_read_at
      or new.user_b_archived_at is distinct from old.user_b_archived_at
    then
      raise exception 'You may only update your own read/archive state';
    end if;
  elsif (select auth.uid()) = old.user_b_id then
    if new.user_a_last_read_at is distinct from old.user_a_last_read_at
      or new.user_a_archived_at is distinct from old.user_a_archived_at
    then
      raise exception 'You may only update your own read/archive state';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.prevent_conversation_tampering() from public, anon, authenticated;

drop trigger if exists conversations_prevent_tampering on public.conversations;
create trigger conversations_prevent_tampering
  before update on public.conversations
  for each row
  execute function public.prevent_conversation_tampering();

-- ============ MESSAGES: block-aware insert policy ============
drop policy if exists "Participants send messages in their own conversations" on public.messages;
create policy "Participants send messages in their own conversations"
  on public.messages for insert
  to authenticated
  with check (
    sender_id = (select auth.uid())
    and exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id
        and (c.user_a_id = (select auth.uid()) or c.user_b_id = (select auth.uid()))
        and not public.is_blocked(c.user_a_id, c.user_b_id)
    )
  );

-- ============ MESSAGES: sensitive-content guard ============
-- Heuristic, deliberately conservative in what it lets through rather than
-- what it flags — see this migration's own header comment. `body`'s own
-- length/non-blank check constraint (0025) is unaffected; this is an
-- additional, independent rejection reason.
create or replace function public.validate_message_content()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_compact text;
begin
  if auth.uid() is null or public.is_staff() then
    return new;
  end if;

  -- Card-like number: 13-19 digits, allowing a single space or dash between
  -- any two digits — how people naturally type "4111 1111 1111 1111" or
  -- "4111-1111-1111-1111".
  if new.body ~ '[0-9](?:[ -]?[0-9]){12,18}' then
    raise exception 'Messages can''t include what looks like a card number — payment happens through Pinpals checkout, never in chat.';
  end if;

  -- IBAN-shaped: 2 letters + 2 digits + 11-30 more alphanumerics, spaces/
  -- dashes stripped first since IBANs are conventionally shown in
  -- 4-character groups ("IE29 AIBK 9311 5212 3456 78").
  v_compact := regexp_replace(new.body, '[ -]', '', 'g');
  if v_compact ~ '[A-Za-z]{2}[0-9]{2}[A-Za-z0-9]{11,30}' then
    raise exception 'Messages can''t include what looks like a bank account or IBAN number.';
  end if;

  -- A verification-sounding word within ~15 characters of a 4+ digit run
  -- (space/dash-separated groups allowed, same as the card-number rule
  -- above — "sort code 12-34-56" is 6 digits split into three pairs) —
  -- aimed at passport/PPS/SSN numbers and one-time verification codes.
  if new.body ~* '(passport|pps\s*(no|number)?|social security|ssn|sort code|routing number|verification code|\botp\b)\D{0,15}(?:[0-9][ -]?){3,}[0-9]' then
    raise exception 'Messages can''t include identity-verification numbers or codes.';
  end if;

  return new;
end;
$$;

revoke all on function public.validate_message_content() from public, anon, authenticated;

drop trigger if exists messages_validate_content on public.messages;
create trigger messages_validate_content
  before insert on public.messages
  for each row
  execute function public.validate_message_content();

-- ============ Unread counts, computed in ONE query for the whole inbox ============
-- SECURITY INVOKER (the default, spelled out for clarity) — deliberately
-- NOT definer: this only ever aggregates over rows the caller's own RLS
-- policies already let them read directly (their own conversations, and
-- messages within them), so there's no privilege to bypass and nothing new
-- is exposed beyond what listConversationsForInbox() (src/lib/
-- conversations-server.ts) already fetches row-by-row. One correlated
-- subquery per conversation, planned and executed as a single statement —
-- an index range scan against messages_conversation_created_idx (0025) per
-- row, not a separate round-trip per conversation, which is what the task's
-- "avoid one subscription per row" instruction is really guarding against
-- for reads too, not just Realtime.
create or replace function public.conversation_unread_counts()
returns table (conversation_id bigint, unread_count bigint)
language sql
security invoker
set search_path = public
stable
as $$
  select
    c.id,
    (
      select count(*) from public.messages m
      where m.conversation_id = c.id
        and m.sender_id <> (select auth.uid())
        and m.created_at > coalesce(
          case when c.user_a_id = (select auth.uid()) then c.user_a_last_read_at else c.user_b_last_read_at end,
          '-infinity'::timestamptz
        )
    )
  from public.conversations c
  where c.user_a_id = (select auth.uid()) or c.user_b_id = (select auth.uid());
$$;

revoke all on function public.conversation_unread_counts() from public;
revoke execute on function public.conversation_unread_counts() from anon;
grant execute on function public.conversation_unread_counts() to authenticated;
