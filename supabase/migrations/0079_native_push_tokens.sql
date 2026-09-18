-- Pinpals: native push tokens
--
-- 0075 built web push: a browser subscription is the triple
-- (endpoint, p256dh, auth), encrypted per RFC 8291 and posted to a browser
-- vendor's push service. A native iOS device is not that shape. Expo hands
-- back a single opaque token — `ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]` —
-- which is POSTed to Expo's push service, which forwards to APNs. There is no
-- key agreement and no payload encryption, so p256dh and auth have no meaning.
--
-- ONE TABLE, NOT TWO. A separate `device_push_tokens` table is cleaner on
-- paper and worse in practice: sendPushToUser() would fan out over two
-- queries, prune in two places, and the second place is the one nobody
-- updates. A `platform` discriminator keeps one row-per-device model, one
-- fan-out loop, one pruning path, and leaves the settings page's device list
-- working unchanged.
--
-- THE CONSTRAINTS ARE THE INTERESTING PART. 0075's CHECKs all assume a web
-- endpoint: `endpoint like 'https://%'` and `char_length(endpoint) between 20
-- and 2000`, with p256dh and auth NOT NULL. An Expo token is ~41 characters
-- and starts with `ExponentPushToken[`, so it fails the https check outright.
-- Each constraint below becomes conditional on platform rather than being
-- dropped — a web row is still held to exactly the rules 0075 set for it.
--
-- WHY register_push_subscription IS DROPPED AND RECREATED, NOT OVERLOADED.
-- Adding a 5-argument version alongside the existing 4-argument one makes
-- every call with 4 named arguments ambiguous, and PostgREST reports that as a
-- 300 rather than as anything legible. That is precisely the failure recorded
-- in claude/incident-notify-user-overload-ambiguity.md. So: drop, recreate
-- with defaults such that the existing web caller resolves unchanged, and
-- re-apply the grants by hand — a newly created function gets EXECUTE to
-- PUBLIC by default, and this one is SECURITY DEFINER.
--
-- Rollback:
--   drop function if exists public.register_push_subscription(text, text, text, text, text);
--   -- recreate the 4-arg version from 0075 and re-grant to authenticated, service_role.
--   delete from public.push_subscriptions where platform <> 'web';
--   alter table public.push_subscriptions
--     drop constraint if exists push_subscriptions_platform_check,
--     drop constraint if exists push_subscriptions_web_keys_present,
--     drop constraint if exists push_subscriptions_endpoint_shape,
--     drop column if exists platform;
--   alter table public.push_subscriptions
--     alter column p256dh set not null,
--     alter column auth set not null;
--   -- and restore push_subscriptions_endpoint_https from 0075.

-- ===========================================================================
-- 1. The discriminator
-- ===========================================================================
--
-- Defaulting to 'web' backfills every existing row correctly: until this
-- migration there was no other kind. 'android' is allowed now so that adding
-- Android later is a client change rather than another migration against a
-- table that by then has live rows in it.

alter table public.push_subscriptions
  add column platform text not null default 'web';

alter table public.push_subscriptions
  add constraint push_subscriptions_platform_check
    check (platform in ('web', 'ios', 'android'));

-- ===========================================================================
-- 2. Relax the web-shaped constraints, conditionally
-- ===========================================================================

alter table public.push_subscriptions
  alter column p256dh drop not null,
  alter column auth   drop not null;

-- A web row without its key pair is unsendable, and would fail silently at
-- encryption time rather than loudly here. Keep it impossible.
alter table public.push_subscriptions
  add constraint push_subscriptions_web_keys_present
    check (
      platform <> 'web'
      or (p256dh is not null and auth is not null)
    );

-- 0075's length CHECKs on p256dh and auth still apply when the columns are
-- non-null; a CHECK is not violated by NULL, so they need no change.

alter table public.push_subscriptions
  drop constraint if exists push_subscriptions_endpoint_https;

alter table public.push_subscriptions
  add constraint push_subscriptions_endpoint_shape
    check (
      case platform
        when 'web' then endpoint like 'https://%'
        else endpoint like 'ExponentPushToken[%]'
             or endpoint like 'ExpoPushToken[%]'
      end
    );

-- The existing length CHECK is `between 20 and 2000`. An Expo token is about
-- 41 characters, so it already passes. The global UNIQUE on endpoint also
-- still does its job: an Expo token identifies an installation, so the
-- shared-device rewrite in register_push_subscription() works identically for
-- native — reinstall or hand the phone over, and the row MOVES to whoever
-- registers it rather than leaving one member's alerts on another's phone.

comment on column public.push_subscriptions.platform is
  'web = RFC 8291 browser subscription (endpoint + p256dh + auth). '
  'ios/android = Expo push token in endpoint; p256dh and auth are null.';

-- ===========================================================================
-- 3. Registration, widened
-- ===========================================================================
--
-- Same security property as 0075, unchanged and worth restating because it is
-- the whole reason this function may bypass RLS: the row is always assigned to
-- `v_user_id`, the caller, never to a parameter. A member can claim a device
-- for themselves and can never assign one to anybody else.
--
-- Argument order puts p_platform last with a default, so the website's
-- existing call — four named arguments — resolves against this function with
-- no change to src/lib/push.ts.

drop function if exists public.register_push_subscription(text, text, text, text);

create function public.register_push_subscription(
  p_endpoint   text,
  p_p256dh     text default null,
  p_auth       text default null,
  p_user_agent text default null,
  p_platform   text default 'web'
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

  if p_platform not in ('web', 'ios', 'android') then
    raise exception 'register_push_subscription: unknown platform %', p_platform;
  end if;

  -- Caught here as well as by the CHECK so the client gets a message naming
  -- the actual problem rather than a constraint name.
  if p_platform = 'web' and (p_p256dh is null or p_auth is null) then
    raise exception 'register_push_subscription: web subscriptions require p256dh and auth';
  end if;

  insert into public.push_subscriptions
    (user_id, endpoint, p256dh, auth, user_agent, platform)
  values
    (v_user_id, p_endpoint, p_p256dh, p_auth, left(p_user_agent, 400), p_platform)
  on conflict (endpoint) do update
    set user_id       = v_user_id,
        p256dh        = excluded.p256dh,
        auth          = excluded.auth,
        user_agent    = excluded.user_agent,
        platform      = excluded.platform,
        last_seen_at  = now(),
        failure_count = 0
  returning id into v_id;

  return v_id;
end;
$function$;

revoke all on function public.register_push_subscription(text, text, text, text, text) from public;
grant execute on function public.register_push_subscription(text, text, text, text, text)
  to authenticated, service_role;
