-- Realtime Authorization for the two private broadcast topics
-- src/lib/realtime.ts sends to — conversation-<id> and inbox-<userId> (see
-- that file's own header comment for the full design).
--
-- WHY THIS FILE LIVES OUTSIDE supabase/migrations/: everything in that
-- directory is replayed against a from-scratch `postgres:16` container by
-- supabase/tests/rls/replay-migrations.sh for local dev and CI (see that
-- script's own header), and that container has no `realtime` schema at all
-- — it's a Supabase-managed extension/schema provisioned on the actual
-- hosted project, not something `create extension` in a plain Postgres
-- container can stand up. A migration touching `realtime.messages` in the
-- numbered sequence would break every local/CI replay. This file is the
-- real, reviewable source of the policies below — apply it once, directly
-- against the live project (Supabase Studio's SQL editor, or
-- `supabase db execute -f supabase/realtime/0001_messaging_broadcast_authorization.sql`
-- if using the CLI linked to this project) — same manual-apply footing as
-- any other Supabase-dashboard-level config (Storage bucket settings not
-- expressible as `storage.objects`/`storage.buckets` rows, auth email
-- templates, etc.) that isn't part of the public-schema migration history.
--
-- Idempotent: every statement below is safe to re-run.

alter table realtime.messages enable row level security;

-- ============ conversation-<id>: this thread's own participants only ============
-- realtime.topic() reads the channel name the client subscribed to;
-- `conversation-<id>` -> split off the id and re-check participancy exactly
-- the way messages' own SELECT policy (0025_messaging.sql) already does —
-- so a broadcast recipient can never learn anything an ordinary table read
-- wouldn't already have told them.
drop policy if exists "conversation participants receive their thread's broadcasts" on realtime.messages;
create policy "conversation participants receive their thread's broadcasts"
  on realtime.messages for select
  to authenticated
  using (
    realtime.topic() like 'conversation-%'
    and exists (
      select 1 from public.conversations c
      where c.id = split_part(realtime.topic(), '-', 2)::bigint
        and (c.user_a_id = (select auth.uid()) or c.user_b_id = (select auth.uid()))
    )
  );

-- ============ inbox-<userId>: that user only ============
drop policy if exists "members receive their own inbox pings" on realtime.messages;
create policy "members receive their own inbox pings"
  on realtime.messages for select
  to authenticated
  using (
    realtime.topic() like 'inbox-%'
    and split_part(realtime.topic(), '-', 2) = (select auth.uid())::text
  );

-- No INSERT policy for `authenticated` on either topic, deliberately:
-- everything is broadcast server-side via the service-role key
-- (src/lib/realtime.ts's broadcast(), which bypasses RLS entirely), so a
-- client can only ever RECEIVE on these topics, never publish to them —
-- spoofing a "new message" event still requires an actual authorized
-- `messages` insert, not just a Realtime connection.
revoke insert, update, delete on realtime.messages from authenticated, anon;
