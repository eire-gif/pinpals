-- ============================================================================
-- Photos in a message, and finding one afterwards
-- ============================================================================
--
-- Two things the inbox could not do, and one rule that governs both.
--
-- A PHOTO IN A MESSAGE. Everything in this app that accepts a photo from a
-- phone goes through sharp on the server first — see src/lib/images/upload.ts
-- and claude/incident-avatar-exif-gps.md, which is what happens when
-- something doesn't. A phone photo carries EXIF, EXIF carries GPS, and a
-- member photographing a club in their own hall is otherwise handing over
-- their home's coordinates.
--
-- So this bucket is different from the two that already exist, in two ways
-- that both matter:
--
--   It is PRIVATE. `listing-images` and `member-avatars` are public, and
--   correctly so — a marketplace tile and a directory card are both <img>
--   tags served to anyone. A photo sent inside a conversation is the
--   opposite of that. Private means the object is reachable only through a
--   signed URL, and a signed URL is only issued to someone the SELECT policy
--   below already agrees is a participant. Obscurity is not the boundary;
--   the policy is.
--
--   Members cannot INSERT into it at all. There is no upload policy for
--   `authenticated` here — only the service role writes, which means the one
--   and only way a row can appear in this bucket is through
--   uploadMessageImage() and therefore through sharp. `listing-images` lets
--   the member's own client write into their own folder, and that is a door
--   this bucket deliberately does not have: there is no second path to
--   forget to strip metadata on.
--
-- `messages.image_path` stores the STORAGE PATH, never a URL. A signed URL
-- expires, and a column full of expired URLs is a thread whose photos all
-- stop loading on a timer. The app signs on read.
--
-- SEARCHING MESSAGES. The inbox knows each thread's last_message_at and
-- nothing about what any message said, so "find the message where he named
-- the price" had no answer. search_my_messages() below is that answer:
-- SECURITY INVOKER, so `messages`' own participant-only SELECT policy is
-- what decides which rows can match, exactly as it decides which rows can be
-- read one at a time. There is no privilege here to bypass and nothing is
-- exposed that listMessages() could not already fetch.
--
-- Rollback:
--   drop function if exists public.search_my_messages(text, integer);
--   drop index if exists public.messages_body_search_idx;
--   alter table public.messages drop column if exists image_path;
--   -- and restore messages_body_check to its 0025 form.


-- ============ A photo on a message ============

alter table public.messages
  add column if not exists image_path text;

-- The body check has to change, because a photo-only message has no body.
--
-- `body` stays NOT NULL rather than becoming nullable: every reader in the
-- app and on the website treats it as a string, and making it nullable would
-- mean auditing all of them for a null that only ever means "there's a
-- picture instead". An empty string says the same thing and breaks nothing.
--
-- What is NOT relaxed is the requirement that a message carry something. A
-- row with no body and no image is not a message, and the check still
-- refuses it.
alter table public.messages drop constraint if exists messages_body_check;

alter table public.messages
  add constraint messages_body_check
  check (
    (char_length(trim(both from body)) > 0 or image_path is not null)
    and char_length(body) <= 4000
  );


-- ============ The bucket ============
--
-- 5MB matches `listing-images`. The upload path downscales to 1600px long
-- edge before it ever gets here, so the limit is a backstop against a
-- malformed request rather than a size members will meet.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'message-images',
  'message-images',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

-- Objects are named `<conversation_id>/<uuid>.<ext>`, so the folder IS the
-- authorization key. This reads it back.
--
-- The CASE is not decoration. A policy that cast the first path segment to
-- bigint directly would raise on any object whose name did not start with
-- digits, and a policy that raises is a policy that fails somebody's query
-- rather than declining it. Postgres guarantees CASE evaluates in order, so
-- the regexp genuinely guards the cast — an AND of the two would not.
create or replace function public.message_image_conversation_id(object_name text)
returns bigint
language sql
immutable
set search_path = public
as $$
  select case
    when split_part(object_name, '/', 1) ~ '^[0-9]+$'
      then split_part(object_name, '/', 1)::bigint
    else null
  end;
$$;

revoke all on function public.message_image_conversation_id(text) from public, anon;
grant execute on function public.message_image_conversation_id(text) to authenticated;

-- Read: participants of that conversation, and nobody else. This is what a
-- signed URL is issued against, so it is the whole boundary.
drop policy if exists "conversation participants read message photos" on storage.objects;
create policy "conversation participants read message photos"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'message-images'
    and exists (
      select 1 from public.conversations c
      where c.id = public.message_image_conversation_id(name)
        and (c.user_a_id = (select auth.uid()) or c.user_b_id = (select auth.uid()))
    )
  );

-- No insert, update or delete policy for `authenticated` on this bucket, on
-- purpose — see this file's header. The service role bypasses RLS, which is
-- how uploadMessageImage() writes, and it is the only way anything gets in.
--
-- Deliberately NOT backed by a table-level revoke here, unlike the pattern
-- the rest of these migrations use: storage.objects is one table shared by
-- every bucket, and a revoke on it would reach `listing-images` and
-- `member-avatars` as well. RLS is enabled on storage.objects and every
-- policy on it is bucket-scoped, so for this bucket "no policy" is the whole
-- of "no access".


-- ============ Searching your own messages ============
--
-- `english` is spelled out rather than left to default_text_search_config,
-- because to_tsvector(regconfig, text) is immutable and to_tsvector(text) is
-- not — only the two-argument form can be indexed. Irish place and club
-- names stem harmlessly under it; the alternative ('simple') would lose
-- "playing"/"played" matching for no gain.
create index if not exists messages_body_search_idx
  on public.messages using gin (to_tsvector('english', body));

-- websearch_to_tsquery, not plainto_tsquery: it understands quoted phrases
-- and OR the way anyone who has used a search box expects, and — unlike
-- to_tsquery — it cannot raise a syntax error on whatever someone types,
-- which matters for a field that searches on every keystroke.
--
-- Hidden messages are excluded. A moderated message shows as "This message
-- was removed" in the thread, and a search that could still find it by its
-- text would undo that.
create or replace function public.search_my_messages(p_query text, p_limit integer default 30)
returns table (
  id bigint,
  conversation_id bigint,
  sender_id uuid,
  body text,
  created_at timestamptz
)
language sql
security invoker
set search_path = public
stable
as $$
  select m.id, m.conversation_id, m.sender_id, m.body, m.created_at
  from public.messages m
  where m.hidden_at is null
    and trim(coalesce(p_query, '')) <> ''
    and to_tsvector('english', m.body) @@ websearch_to_tsquery('english', p_query)
  order by m.created_at desc, m.id desc
  limit least(greatest(coalesce(p_limit, 30), 1), 100);
$$;

revoke all on function public.search_my_messages(text, integer) from public;
revoke execute on function public.search_my_messages(text, integer) from anon;
grant execute on function public.search_my_messages(text, integer) to authenticated;
