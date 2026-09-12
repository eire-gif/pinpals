-- Pinpals: web push notifications
--
-- Adds the second delivery channel. Until now `notifyUser()`
-- (src/lib/notifications-server.ts) had exactly one outbound path — email —
-- and `notification_preferences` modelled exactly one axis to match
-- (`email_enabled` per category). This migration adds device subscriptions,
-- a per-category push switch, and — the part worth reading carefully — fixes
-- a latent bug in `notify_user()` that only becomes visible once a second
-- channel exists.
--
-- THE BUG. `notify_user()` dedupes with `on conflict ... do nothing` against
-- the partial unique index on (user_id, dedupe_key). It returns `void`, so
-- its TypeScript caller cannot tell a suppressed duplicate from a real
-- insert — and sends the email either way. Today a retried webhook or a
-- repeated sweep produces a second email for an event the member already
-- has, with no in-app row behind it. Add push on the same path and that
-- same duplicate now buzzes their phone. Returning the inserted id (null on
-- conflict) lets `notifyUser()` suppress BOTH channels, which is what the
-- dedupe index was always for.
--
-- THE PREFERENCE SHAPE. A `(user_id, category, channel, enabled)` row model
-- was considered and rejected. The CHECK constraint on `category` is the
-- entire mechanism that makes 'payments' and 'disputes_refunds'
-- unsilenceable (0056's design decision 3) — a second column preserves it
-- untouched, keeps the settings page's "one upsert per submit covers every
-- row" property, and keeps "off" distinguishable from "never visited". A
-- row model buys flexibility this app has no use for until a third channel
-- (WhatsApp) exists. Revisit then, not now.
--
-- DEFAULTS. `push_enabled` defaults to true, matching `email_enabled`. This
-- cannot produce an unrequested notification: push also requires a row in
-- push_subscriptions, which only ever appears after a member has granted
-- browser permission explicitly. The default simply keeps "no stored row
-- means enabled" true for both channels at once.
--
-- Rollback:
--   drop trigger if exists push_subscriptions_set_last_seen on public.push_subscriptions;
--   drop function if exists public.register_push_subscription(text, text, text, text);
--   drop table if exists public.push_subscriptions;
--   alter table public.notification_preferences drop column if exists push_enabled;
--   -- and restore notify_user()'s void signature from 0056/0057.

-- ===========================================================================
-- 1. Device subscriptions
-- ===========================================================================
--
-- One row per browser installation, not per member: a member legitimately
-- has several (phone, iPad, laptop), and `user_agent` exists so the settings
-- page can label them ("iPhone · added 3 Sept") beside a Remove button. It
-- is member-supplied text — escape it like any other.
--
-- `endpoint` is UNIQUE GLOBALLY, not per user, and that is deliberate. An
-- endpoint identifies a browser installation, not a person. Sign out on a
-- shared iPad and sign in as someone else, and the browser hands back the
-- SAME endpoint. Without the global constraint that produces two rows and
-- one member's tee-time invites buzzing on another member's lock screen.
-- register_push_subscription() below resolves the collision by MOVING the
-- endpoint to whoever is registering it.
--
-- The stored triple (endpoint, p256dh, auth) is a send-capability: anyone
-- holding it can push to that device until it unsubscribes. No anon access,
-- ever.

create table public.push_subscriptions (
  id              bigint generated always as identity primary key,
  user_id         uuid not null references public.profiles(id) on delete cascade,
  endpoint        text not null,
  p256dh          text not null,
  auth            text not null,
  user_agent      text,
  created_at      timestamptz not null default now(),
  last_seen_at    timestamptz not null default now(),
  last_success_at timestamptz,
  failure_count   integer not null default 0,

  constraint push_subscriptions_endpoint_key unique (endpoint),
  constraint push_subscriptions_endpoint_check
    check (char_length(endpoint) between 20 and 2000),
  constraint push_subscriptions_endpoint_https
    check (endpoint like 'https://%'),
  constraint push_subscriptions_p256dh_check
    check (char_length(p256dh) between 20 and 255),
  constraint push_subscriptions_auth_check
    check (char_length(auth) between 8 and 255),
  constraint push_subscriptions_user_agent_check
    check (user_agent is null or char_length(user_agent) <= 400),
  constraint push_subscriptions_failure_count_check
    check (failure_count >= 0)
);

create index push_subscriptions_user_id_idx
  on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

-- Deliberately only SELECT and DELETE for members — the same shape as
-- `notifications` (0042), which has no authenticated INSERT policy either
-- and routes every write through a SECURITY DEFINER function. Registration
-- goes through register_push_subscription() below because the shared-device
-- case needs to rewrite a row the caller does not yet own, which no
-- `using (user_id = auth.uid())` policy can ever permit. With no INSERT or
-- UPDATE policy at all there is nothing for a member to tamper with, so no
-- prevent_*_tampering() trigger is needed here.
--
-- `(select auth.uid())` rather than a bare call, per 0028_rls_initplan_performance.

create policy "members view their own push subscriptions"
  on public.push_subscriptions for select to authenticated
  using (user_id = (select auth.uid()));

create policy "members remove their own push subscriptions"
  on public.push_subscriptions for delete to authenticated
  using (user_id = (select auth.uid()));

-- ===========================================================================
-- 2. Registration
-- ===========================================================================
--
-- Always assigns the row to the CALLER — `v_user_id`, never a parameter — so
-- a member can claim an endpoint for themselves and can never assign one to
-- anybody else. That single property is what makes it safe to let this
-- function bypass RLS on a row the caller does not own.

create function public.register_push_subscription(
  p_endpoint   text,
  p_p256dh     text,
  p_auth       text,
  p_user_agent text default null
)
returns bigint
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_user_id uuid := (select auth.uid());
  v_id      bigint;
begin
  if v_user_id is null then
    raise exception 'register_push_subscription requires an authenticated member';
  end if;

  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  values (v_user_id, p_endpoint, p_p256dh, p_auth, left(p_user_agent, 400))
  on conflict (endpoint) do update
    set user_id       = v_user_id,
        p256dh        = excluded.p256dh,
        auth          = excluded.auth,
        user_agent    = excluded.user_agent,
        last_seen_at  = now(),
        failure_count = 0
  returning id into v_id;

  return v_id;
end;
$function$;

revoke all on function public.register_push_subscription(text, text, text, text) from public;
grant execute on function public.register_push_subscription(text, text, text, text) to authenticated, service_role;

-- ===========================================================================
-- 3. The second preference axis
-- ===========================================================================
--
-- `category`'s CHECK constraint is untouched, so 'payments' and
-- 'disputes_refunds' remain structurally unable to have a row here — money
-- notifications cannot be silenced on push any more than they can on email.

alter table public.notification_preferences
  add column push_enabled boolean not null default true;

-- ===========================================================================
-- 4. notify_user() now reports whether it actually inserted
-- ===========================================================================
--
-- Postgres cannot change a function's return type in place, so this is a
-- DROP and CREATE rather than a CREATE OR REPLACE.
--
-- Every SQL caller keeps working unchanged — offer_action(),
-- apply_new_bid(), run_auction_sweeps(), release_expired_offer_reservations(),
-- invalidate_offers_on_listing_unavailable() and notify_seller_of_new_offer()
-- all call it as a statement and discard the result, which both plpgsql
-- `perform` and a SQL-function body tolerate. They are NOT recreated here.
-- But because the function is dropped rather than replaced, every one of
-- them must be exercised by a real migration replay plus the RLS suite
-- before this ships — a typecheck proves nothing about any of them.
--
-- THE GRANTS MATTER. A newly created function gets EXECUTE to PUBLIC by
-- default. The dropped function's ACL was {postgres, service_role} only —
-- notably NOT authenticated or anon. Recreating without the REVOKE below
-- would silently hand every logged-in member (and every anonymous visitor)
-- the ability to write arbitrary notification rows to any user_id, since
-- the function is SECURITY DEFINER. The revoke is not tidiness; it is the
-- whole boundary.

drop function if exists public.notify_user(uuid, text, text, text, jsonb, text);

create function public.notify_user(
  p_user_id    uuid,
  p_type       text,
  p_title      text,
  p_body       text,
  p_data       jsonb default '{}'::jsonb,
  p_dedupe_key text default null
)
returns bigint
language sql
security definer
set search_path to 'public'
as $function$
  insert into public.notifications (user_id, type, title, body, data, dedupe_key)
  values (p_user_id, p_type, p_title, p_body, p_data, p_dedupe_key)
  on conflict (user_id, dedupe_key) where dedupe_key is not null do nothing
  returning id;
$function$;

revoke all on function public.notify_user(uuid, text, text, text, jsonb, text) from public;
grant execute on function public.notify_user(uuid, text, text, text, jsonb, text) to service_role;
