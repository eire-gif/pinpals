-- Scorecard certification (Oct 2026).
--
-- A playing partner confirms your card, the way a marker signs a paper one,
-- and the card then shows who certified it, how and when:
--
--   ✓ Certified by John Murphy · Face ID · 12 Oct, 17:42
--
-- THE FLOW
--
--   1. The owner finishes the round and asks one person to certify the card
--      (scorecard_certify_request). For a card from a live round that person
--      must be a member who played in that round; for a card typed in by
--      hand, one of the owner's accepted PinPals. Never across a block.
--   2. The certifier opens the request on their own phone
--      (scorecard_certification_open), checks the scores hole by hole, and
--      either certifies (scorecard_certify), queries a hole
--      (scorecard_certification_query) or declines.
--   3. Certifying happens behind the phone's Face ID / Touch ID / fingerprint.
--
-- WHY A KEY AND NOT JUST "FACE ID SAID YES"
--
--   A biometric check on its own only happens on the phone; the server would
--   just be taking the app's word for it. So each member's phone holds a
--   certification key (scorecard_certify_keys): 32 random bytes made here,
--   handed to the phone once, and stored by the phone in its secure storage
--   behind biometrics (expo-secure-store, requireAuthentication — the iOS
--   Keychain with biometryCurrentSet, the Android Keystore with a
--   BIOMETRIC_STRONG key). The phone can only read it back after a
--   successful Face ID or fingerprint, and then signs
--
--     pinpals-certify:v1:<request id>:<challenge>:<card hash>
--
--   with HMAC-SHA-256. scorecard_certify() recomputes that here, so a
--   certificate always needs the certifier's own signed-in account AND a key
--   it set up, over exactly this request and this card. No biometric data
--   ever leaves the phone or reaches PinPals.
--
--   WHAT IT DOESN'T PROVE: the secret is made here and handed to whichever
--   signed-in client asks, and the method ("face_id" …) is what the app
--   reports. The real app only ever reads the key back through Face ID or a
--   fingerprint, but a modified client using the certifier's own login could
--   sign without one. Closing that needs a key pair made inside the Secure
--   Enclave / Keystore plus App Attest / Play Integrity — native modules, so
--   a store build; see claude/scorecard-certification.md. For a members'
--   trust badge (not a handicap submission) the certifier's own account
--   vouching is the substance; the biometric is what makes it deliberate.
--
--   Phones with no usable biometrics can still certify, recorded honestly
--   as method 'in_app' ("Certified in the app") rather than Face ID.
--
-- THE CARD CAN'T CHANGE UNDER A CERTIFICATE
--
--   The request records a hash of what is being certified: course, tees,
--   holes, date, rating, slope, par, index, playing handicap, and par / SI /
--   strokes per hole (not putts, yards or visibility). Built as jsonb, so no
--   field can bleed into the next, and the date is formatted explicitly. Any later change to those — an edit, or
--   "Update from the live round" — voids a pending or certified request by
--   trigger, and the card shows as no longer certified until it's asked again.
--
-- WHO SEES WHAT
--
--   scorecard_certifications: the owner and the certifier see their rows;
--   anyone who may see the card (0110's rules) sees only its CERTIFIED row —
--   the badge. Queries and their notes stay between the two of them. The
--   challenge and card hash are never readable directly (column grants).
--   scorecard_certify_keys: readable by nobody but these functions.
--   The certifier can open the card itself only while it's pending or
--   certified, never across a block, so being asked once isn't a lasting
--   window onto a card set to "Only me".
--
-- LIMITS: 30 requests a day per owner, 5 per card a day, 5 a day to the same
-- certifier — a re-ask cancels the last, but each one is a new notification.
--
-- NOTIFICATIONS are sent by the website (src/lib/scorecard-certify-notifications.ts)
-- after the app writes, as with live scoring (0104): push, email and
-- preferences live in notifyUser().
--
-- ACCOUNT DELETION: keys go with the member (cascade). A deleted certifier's
-- name on someone else's card becomes "Former member" (trigger), the way a
-- live round's player row does (0103). A deleted owner's card goes, and its
-- certifications with it.
--
-- Rollback:
--   drop trigger if exists scorecard_holes_check_certification on public.scorecard_holes;
--   drop trigger if exists scorecards_check_certification on public.scorecards;
--   drop trigger if exists scorecard_certifications_former_member on public.scorecard_certifications;
--   drop function if exists public.scorecard_certifications_check_card(), public.scorecard_certifications_former_member(),
--     public.scorecard_card_hash(bigint), public.scorecard_certify_candidates(bigint),
--     public.scorecard_certify_request(bigint, uuid), public.scorecard_certification_open(bigint),
--     public.scorecard_certify_key_register(text), public.scorecard_certify_key_confirm(uuid),
--     public.scorecard_certify(bigint, uuid, text, text),
--     public.scorecard_certification_query(bigint, smallint, text), public.scorecard_certification_decline(bigint),
--     public.my_certification_requests();
--   drop table if exists public.scorecard_certifications, public.scorecard_certify_keys;

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.scorecard_certify_keys (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.profiles (id) on delete cascade,
  secret bytea not null check (octet_length(secret) = 32),
  platform text not null check (platform in ('ios', 'android')),
  -- clock_timestamp: "oldest" must mean something even within one transaction.
  created_at timestamptz not null default clock_timestamp(),
  -- Set once the phone has stored the secret behind biometrics. Only
  -- confirmed keys sign, and only confirmed keys count towards (or are
  -- retired by) the five-a-member limit — a cancelled set-up retires nothing.
  confirmed_at timestamptz,
  last_used_at timestamptz,
  revoked_at timestamptz
);

create index scorecard_certify_keys_member_idx on public.scorecard_certify_keys (member_id) where revoked_at is null;

comment on table public.scorecard_certify_keys is 'Per-phone certification keys (0128). The phone keeps the secret behind Face ID / fingerprint and signs certifications with it. Never readable by clients.';

create table public.scorecard_certifications (
  id bigint generated always as identity primary key,
  scorecard_id bigint not null references public.scorecards (id) on delete cascade,
  owner_id uuid not null references public.profiles (id) on delete cascade,
  certifier_id uuid references public.profiles (id) on delete set null,
  -- As it was when asked: the badge must still read sensibly if the
  -- certifier's account goes (then "Former member", by trigger).
  certifier_name text not null check (char_length(certifier_name) between 1 and 80),
  status text not null default 'pending'
    check (status in ('pending', 'certified', 'queried', 'declined', 'void', 'cancelled')),
  card_hash text not null check (card_hash ~ '^[0-9a-f]{64}$'),
  challenge text not null check (challenge ~ '^[0-9a-f]{32}$'),
  method text check (method is null or method in ('face_id', 'touch_id', 'biometric', 'in_app')),
  key_id uuid references public.scorecard_certify_keys (id) on delete set null,
  query_hole smallint check (query_hole is null or query_hole between 1 and 18),
  query_note text check (query_note is null or char_length(query_note) <= 200),
  requested_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '48 hours',
  responded_at timestamptz,
  check (status <> 'certified' or method is not null)
);

-- One live request or certificate per card at a time.
create unique index scorecard_certifications_open_idx
  on public.scorecard_certifications (scorecard_id) where status in ('pending', 'queried', 'certified');
create index scorecard_certifications_card_idx on public.scorecard_certifications (scorecard_id, id desc);
create index scorecard_certifications_certifier_idx
  on public.scorecard_certifications (certifier_id, status) where certifier_id is not null;
create index scorecard_certifications_owner_idx on public.scorecard_certifications (owner_id, requested_at desc);
create index scorecard_certifications_key_idx on public.scorecard_certifications (key_id) where key_id is not null;

comment on table public.scorecard_certifications is 'A playing partner certifying a scorecard (0128). Written only through the scorecard_certify* functions; voided by trigger when the card changes.';

alter table public.scorecard_certify_keys enable row level security;
alter table public.scorecard_certifications enable row level security;

create policy "Read own certification requests and visible certificates"
  on public.scorecard_certifications for select to authenticated
  using (
    owner_id = (select auth.uid())
    or certifier_id = (select auth.uid())
    or (status = 'certified' and exists (select 1 from public.scorecards s where s.id = scorecard_id))
  );

revoke all on public.scorecard_certify_keys, public.scorecard_certifications from anon, authenticated;
-- Everything but the challenge and the card hash.
grant select (id, scorecard_id, owner_id, certifier_id, certifier_name, status, method, query_hole, query_note,
              requested_at, expires_at, responded_at)
  on public.scorecard_certifications to authenticated;

-- ---------------------------------------------------------------------------
-- What is being certified
-- ---------------------------------------------------------------------------

create or replace function public.scorecard_card_hash(p_scorecard_id bigint)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select encode(sha256(convert_to(jsonb_build_object(
           'v', 1,
           'course', s.course_name, 'tees', s.tee_name, 'holes', s.holes,
           'date', to_char(s.played_on, 'YYYY-MM-DD'),
           'rating', s.course_rating::text, 'slope', s.slope, 'par', s.par_total,
           'index', s.handicap_index::text, 'plays_off', s.playing_handicap,
           'card', (select jsonb_agg(jsonb_build_array(h.hole, h.par, h.stroke_index, h.strokes) order by h.hole)
                      from public.scorecard_holes h where h.scorecard_id = s.id))::text, 'UTF8')), 'hex')
    from public.scorecards s
   where s.id = p_scorecard_id;
$$;

revoke all on function public.scorecard_card_hash(bigint) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Who can be asked
-- ---------------------------------------------------------------------------
--
-- The owner only (anyone else gets no rows). From a live round: the other
-- members who played in it. Typed in by hand (or its round since deleted):
-- the owner's accepted PinPals. Never across a block, never a deleted account.

create or replace function public.scorecard_certify_candidates(p_scorecard_id bigint)
returns table (member_id uuid, first_name text, last_name text, avatar_url text, avatar_color text, played_in_round boolean)
language sql
stable
security definer
set search_path = public
as $$
  with card as (
    select s.id, s.member_id, s.live_round_id
      from public.scorecards s
     where s.id = p_scorecard_id and s.member_id = (select auth.uid())
  ),
  people as (
    select lp.member_id as id, true as played
      from card
      join public.live_round_players lp on lp.round_id = card.live_round_id
     where card.live_round_id is not null and lp.member_id is not null and lp.member_id <> card.member_id
    union
    select case when c.requester_id = card.member_id then c.recipient_id else c.requester_id end, false
      from card
      join public.connections c
        on c.status = 'accepted' and (c.requester_id = card.member_id or c.recipient_id = card.member_id)
     where card.live_round_id is null
  )
  select p.id, p.first_name, p.last_name, p.avatar_url, p.avatar_color, people.played
    from people
    join public.profiles p on p.id = people.id and p.deleted_at is null
    cross join card
   where not public.is_blocked(card.member_id, p.id)
   order by p.first_name nulls last, p.last_name nulls last;
$$;

revoke all on function public.scorecard_certify_candidates(bigint) from public, anon, authenticated;
grant execute on function public.scorecard_certify_candidates(bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- Asking
-- ---------------------------------------------------------------------------

create or replace function public.scorecard_certify_request(p_scorecard_id bigint, p_certifier uuid)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_card public.scorecards;
  v_round_status text;
  v_hash text;
  v_name text;
  v_id bigint;
begin
  if v_me is null or not exists (select 1 from public.profiles where id = v_me and deleted_at is null) then
    raise exception 'Sign in to get a card certified' using errcode = '42501';
  end if;

  select * into v_card from public.scorecards where id = p_scorecard_id for update;
  if not found or v_card.member_id <> v_me then
    raise exception 'That scorecard isn''t yours' using errcode = '42501';
  end if;
  if v_card.played_on < current_date - 14 then
    raise exception 'A card can be certified up to 14 days after the round' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.scorecard_holes where scorecard_id = v_card.id and strokes is not null) then
    raise exception 'Put your scores in before asking someone to certify the card' using errcode = 'P0001';
  end if;
  if v_card.live_round_id is not null then
    select status into v_round_status from public.live_rounds where id = v_card.live_round_id;
    if v_round_status = 'live' then
      raise exception 'Finish the round first, then ask a playing partner to certify your card' using errcode = 'P0001';
    end if;
  end if;

  if p_certifier is null or not exists (
    select 1 from public.scorecard_certify_candidates(v_card.id) c where c.member_id = p_certifier
  ) then
    raise exception 'Ask someone who played the round with you' using errcode = '42501';
  end if;

  if (select count(*) from public.scorecard_certifications
       where owner_id = v_me and requested_at > now() - interval '1 day') >= 30
     or (select count(*) from public.scorecard_certifications
          where scorecard_id = v_card.id and requested_at > now() - interval '1 day') >= 5
     or (select count(*) from public.scorecard_certifications
          where owner_id = v_me and certifier_id = p_certifier and requested_at > now() - interval '1 day') >= 5 then
    raise exception 'That''s a lot of requests today — try again tomorrow' using errcode = 'P0001';
  end if;

  v_hash := public.scorecard_card_hash(v_card.id);
  if exists (select 1 from public.scorecard_certifications
              where scorecard_id = v_card.id and status = 'certified' and card_hash = v_hash) then
    raise exception 'This card is already certified' using errcode = 'P0001';
  end if;

  -- A new request replaces whatever was open (an unanswered ask, or a query
  -- the owner has now dealt with).
  update public.scorecard_certifications
     set status = 'cancelled', responded_at = coalesce(responded_at, now())
   where scorecard_id = v_card.id and status in ('pending', 'queried', 'certified');

  select coalesce(nullif(btrim(concat_ws(' ', first_name, last_name)), ''), 'A PinPal')
    into v_name from public.profiles where id = p_certifier;

  insert into public.scorecard_certifications (scorecard_id, owner_id, certifier_id, certifier_name, card_hash, challenge)
  values (v_card.id, v_me, p_certifier, left(v_name, 80), v_hash, encode(extensions.gen_random_bytes(16), 'hex'))
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.scorecard_certify_request(bigint, uuid) from public, anon, authenticated;
grant execute on function public.scorecard_certify_request(bigint, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Opening a request (the certifier's screen, and the owner's status)
-- ---------------------------------------------------------------------------
--
-- The certifier must see the whole card even if it's set to "Only me" —
-- they're being asked to vouch for it — so this reads it as definer, for the
-- two people on the request and nobody else. The challenge goes only to the
-- certifier, and only while there is something to sign.

create or replace function public.scorecard_certification_open(p_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_c public.scorecard_certifications;
  v_card public.scorecards;
  v_owner public.profiles;
  v_status text;
  v_show boolean;
begin
  select * into v_c from public.scorecard_certifications where id = p_id;
  if v_me is null or not found or (v_c.owner_id <> v_me and v_c.certifier_id is distinct from v_me) then
    raise exception 'This request isn''t available' using errcode = '42501';
  end if;
  select * into v_owner from public.profiles where id = v_c.owner_id;
  if v_owner.deleted_at is not null or public.is_blocked(v_c.owner_id, v_me) then
    raise exception 'This request isn''t available' using errcode = '42501';
  end if;

  v_status := case when v_c.status = 'pending' and v_c.expires_at <= now() then 'expired' else v_c.status end;
  -- The owner always sees their card; the certifier only while there's
  -- something to check or a certificate standing on it.
  v_show := v_c.owner_id = v_me or v_status in ('pending', 'certified');
  if v_show then
    select * into v_card from public.scorecards where id = v_c.scorecard_id;
  end if;

  return jsonb_build_object(
    'id', v_c.id,
    'scorecard_id', v_c.scorecard_id,
    'status', v_status,
    'role', case when v_c.owner_id = v_me then 'owner' else 'certifier' end,
    'challenge', case when v_c.certifier_id = v_me and v_status = 'pending' then v_c.challenge end,
    'card_hash', case when v_c.certifier_id = v_me and v_status = 'pending' then v_c.card_hash end,
    'certifier_name', v_c.certifier_name,
    'method', v_c.method,
    'query_hole', v_c.query_hole,
    'query_note', v_c.query_note,
    'requested_at', v_c.requested_at,
    'expires_at', v_c.expires_at,
    'responded_at', v_c.responded_at,
    'owner', jsonb_build_object(
      'id', v_owner.id, 'first_name', v_owner.first_name, 'last_name', v_owner.last_name,
      'avatar_url', v_owner.avatar_url, 'avatar_color', v_owner.avatar_color),
    'card', case when v_show then jsonb_build_object(
      'course_name', v_card.course_name, 'tee_name', v_card.tee_name, 'holes', v_card.holes,
      'played_on', v_card.played_on, 'par_total', v_card.par_total,
      'handicap_index', v_card.handicap_index, 'playing_handicap', v_card.playing_handicap,
      'source', v_card.source) end,
    'hole_list', case when v_show then coalesce((
      select jsonb_agg(jsonb_build_object('hole', h.hole, 'par', h.par, 'stroke_index', h.stroke_index,
                                          'yards', h.yards, 'strokes', h.strokes, 'putts', h.putts) order by h.hole)
        from public.scorecard_holes h where h.scorecard_id = v_c.scorecard_id), '[]'::jsonb) end
  );
end;
$$;

revoke all on function public.scorecard_certification_open(bigint) from public, anon, authenticated;
grant execute on function public.scorecard_certification_open(bigint) to authenticated;

-- Requests waiting for me, newest first.
create or replace function public.my_certification_requests()
returns table (id bigint, scorecard_id bigint, owner_id uuid, first_name text, last_name text, avatar_url text,
               avatar_color text, course_name text, played_on date, requested_at timestamptz, expires_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select c.id, c.scorecard_id, c.owner_id, p.first_name, p.last_name, p.avatar_url, p.avatar_color,
         s.course_name, s.played_on, c.requested_at, c.expires_at
    from public.scorecard_certifications c
    join public.scorecards s on s.id = c.scorecard_id
    join public.profiles p on p.id = c.owner_id and p.deleted_at is null
   where c.certifier_id = (select auth.uid())
     and c.status = 'pending'
     and c.expires_at > now()
     and not public.is_blocked(c.owner_id, c.certifier_id)
   order by c.requested_at desc
   limit 20;
$$;

revoke all on function public.my_certification_requests() from public, anon, authenticated;
grant execute on function public.my_certification_requests() to authenticated;

-- ---------------------------------------------------------------------------
-- A phone's certification key
-- ---------------------------------------------------------------------------
--
-- Made here, returned once, kept by the phone behind biometrics. Two steps:
-- register (the server makes the key), then confirm (the phone has stored
-- it). A member keeps at most five confirmed keys — one per phone, give or
-- take a re-enrolment after Face ID is reset — and confirming a sixth
-- retires the oldest. A set-up cancelled half way leaves an unconfirmed key
-- that can't sign and retires nothing.

create or replace function public.scorecard_certify_key_register(p_platform text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_secret bytea := extensions.gen_random_bytes(32);
  v_id uuid;
begin
  if v_me is null or not exists (select 1 from public.profiles where id = v_me and deleted_at is null) then
    raise exception 'Sign in to certify cards' using errcode = '42501';
  end if;
  if p_platform is null or p_platform not in ('ios', 'android') then
    raise exception 'Certifying needs the PinPals app on an iPhone or Android phone' using errcode = '22023';
  end if;
  if (select count(*) from public.scorecard_certify_keys where member_id = v_me and created_at > now() - interval '1 day') >= 20 then
    raise exception 'Too many set-ups today — try again tomorrow' using errcode = 'P0001';
  end if;

  insert into public.scorecard_certify_keys (member_id, secret, platform)
  values (v_me, v_secret, p_platform)
  returning id into v_id;

  return jsonb_build_object('key_id', v_id, 'secret', encode(v_secret, 'hex'));
end;
$$;

revoke all on function public.scorecard_certify_key_register(text) from public, anon, authenticated;
grant execute on function public.scorecard_certify_key_register(text) to authenticated;

create or replace function public.scorecard_certify_key_confirm(p_key_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
begin
  update public.scorecard_certify_keys set confirmed_at = coalesce(confirmed_at, clock_timestamp())
   where id = p_key_id and member_id = v_me and revoked_at is null;
  if not found then
    raise exception 'This phone needs setting up again to certify cards' using errcode = 'P0001', hint = 'certify_key';
  end if;

  update public.scorecard_certify_keys set revoked_at = now()
   where id in (select k.id from public.scorecard_certify_keys k
                 where k.member_id = v_me and k.revoked_at is null and k.confirmed_at is not null
                 order by k.confirmed_at desc offset 5);
end;
$$;

revoke all on function public.scorecard_certify_key_confirm(uuid) from public, anon, authenticated;
grant execute on function public.scorecard_certify_key_confirm(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Answering
-- ---------------------------------------------------------------------------

-- Shared checks: the caller is the certifier and the request is still open.
-- Returns the row, locked.
create or replace function public.scorecard_certification_for_answer(p_id bigint)
returns public.scorecard_certifications
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_c public.scorecard_certifications;
begin
  select * into v_c from public.scorecard_certifications where id = p_id for update;
  if v_me is null or not found or v_c.certifier_id is distinct from v_me then
    raise exception 'This request isn''t for you' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles where id = v_c.owner_id and deleted_at is null)
     or public.is_blocked(v_c.owner_id, v_me) then
    raise exception 'This request isn''t available' using errcode = '42501';
  end if;
  if v_c.status <> 'pending' then
    raise exception '%', case v_c.status
      when 'void' then 'The card was changed after they asked — they''ll need to send it again'
      when 'cancelled' then 'They''ve withdrawn this request'
      else 'This request has already been answered' end
      using errcode = 'P0001';
  end if;
  if v_c.expires_at <= now() then
    raise exception 'This request has expired — they can send it again' using errcode = 'P0001';
  end if;
  if public.scorecard_card_hash(v_c.scorecard_id) is distinct from v_c.card_hash then
    raise exception 'The card was changed after they asked — they''ll need to send it again' using errcode = 'P0001';
  end if;
  return v_c;
end;
$$;

revoke all on function public.scorecard_certification_for_answer(bigint) from public, anon, authenticated;

create or replace function public.scorecard_certify(p_id bigint, p_key_id uuid, p_signature text, p_method text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_c public.scorecard_certifications;
  v_key public.scorecard_certify_keys;
  v_expected text;
begin
  v_c := public.scorecard_certification_for_answer(p_id);

  if p_method is null or p_method not in ('face_id', 'touch_id', 'biometric', 'in_app') then
    raise exception 'Unknown way of certifying' using errcode = '22023';
  end if;

  if p_method = 'in_app' then
    if p_key_id is not null or p_signature is not null then
      raise exception 'Unknown way of certifying' using errcode = '22023';
    end if;
  else
    select * into v_key from public.scorecard_certify_keys
     where id = p_key_id and member_id = v_c.certifier_id and revoked_at is null and confirmed_at is not null;
    if not found then
      raise exception 'This phone needs setting up again to certify cards' using errcode = 'P0001', hint = 'certify_key';
    end if;
    v_expected := encode(extensions.hmac(
      convert_to(format('pinpals-certify:v1:%s:%s:%s', v_c.id, v_c.challenge, v_c.card_hash), 'UTF8'),
      v_key.secret, 'sha256'), 'hex');
    if p_signature is null or lower(p_signature) <> v_expected then
      raise exception 'That didn''t verify — try again' using errcode = 'P0001', hint = 'certify_key';
    end if;
    update public.scorecard_certify_keys set last_used_at = now() where id = v_key.id;
  end if;

  update public.scorecard_certifications
     set status = 'certified', method = p_method, key_id = v_key.id, responded_at = now()
   where id = v_c.id;
end;
$$;

revoke all on function public.scorecard_certify(bigint, uuid, text, text) from public, anon, authenticated;
grant execute on function public.scorecard_certify(bigint, uuid, text, text) to authenticated;

create or replace function public.scorecard_certification_query(p_id bigint, p_hole smallint, p_note text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_c public.scorecard_certifications;
  v_holes smallint;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  v_c := public.scorecard_certification_for_answer(p_id);
  select holes into v_holes from public.scorecards where id = v_c.scorecard_id;
  if p_hole is null or p_hole < 1 or p_hole > v_holes then
    raise exception 'Pick the hole you''re querying' using errcode = '22023';
  end if;
  if v_note is not null and char_length(v_note) > 200 then
    raise exception 'Keep the note under 200 characters' using errcode = '22023';
  end if;
  update public.scorecard_certifications
     set status = 'queried', query_hole = p_hole, query_note = v_note, responded_at = now()
   where id = v_c.id;
end;
$$;

revoke all on function public.scorecard_certification_query(bigint, smallint, text) from public, anon, authenticated;
grant execute on function public.scorecard_certification_query(bigint, smallint, text) to authenticated;

create or replace function public.scorecard_certification_decline(p_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_c public.scorecard_certifications;
begin
  v_c := public.scorecard_certification_for_answer(p_id);
  update public.scorecard_certifications set status = 'declined', responded_at = now() where id = v_c.id;
end;
$$;

revoke all on function public.scorecard_certification_decline(bigint) from public, anon, authenticated;
grant execute on function public.scorecard_certification_decline(bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

-- A change to what was certified voids the request or certificate.
create or replace function public.scorecard_certifications_check_card()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id bigint := coalesce((to_jsonb(new) ->> 'scorecard_id')::bigint, (to_jsonb(new) ->> 'id')::bigint);
begin
  update public.scorecard_certifications
     set status = 'void', responded_at = coalesce(responded_at, now())
   where scorecard_id = v_id
     and status in ('pending', 'certified')
     and card_hash is distinct from public.scorecard_card_hash(v_id);
  return null;
end;
$$;

revoke all on function public.scorecard_certifications_check_card() from public, anon, authenticated;

create trigger scorecard_holes_check_certification
  after insert or update on public.scorecard_holes
  for each row execute function public.scorecard_certifications_check_card();

create trigger scorecards_check_certification
  after update on public.scorecards
  for each row execute function public.scorecard_certifications_check_card();

-- A certifier's account goes: their name on others' cards goes with it.
create or replace function public.scorecard_certifications_former_member()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.certifier_id is null and old.certifier_id is not null then
    new.certifier_name := 'Former member';
  end if;
  return new;
end;
$$;

revoke all on function public.scorecard_certifications_former_member() from public, anon, authenticated;

create trigger scorecard_certifications_former_member
  before update on public.scorecard_certifications
  for each row execute function public.scorecard_certifications_former_member();
