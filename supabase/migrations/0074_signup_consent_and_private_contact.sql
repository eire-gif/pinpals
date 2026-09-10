-- Pinpals: sign-up consent record, and private member contact details.
--
-- Two additions that ship together because both are written by the same act
-- — someone completing the sign-up form — and both are deliberately kept
-- OFF `profiles`:
--
--   1. `member_consent_events` — an append-only log of every agreement a
--      member has accepted or withdrawn, with the exact document version
--      and content hash they saw.
--   2. `member_private_details` — an optional phone number and the "how did
--      you hear about us" answer, readable by nobody but the member and
--      staff.
--
-- ============ Why neither of these is a column on `profiles` ============
--
-- Exactly the reasoning 0059_member_photos_and_age_bands.sql set out for
-- `date_of_birth`, and it applies here with more force. `profiles` is the
-- member directory: its SELECT policy (0001_init.sql) is "readable by every
-- signed-in member", and several call sites read it with `select("*")`.
-- RLS is row-level — a policy cannot hide one column of a row it allows.
-- A `phone` column on `profiles` would therefore be delivered, in full, to
-- every other member's browser on every directory page load, whatever the
-- UI chose to render. For a phone number that is not a styling bug, it is a
-- data breach, and it is the single most predictable way a platform like
-- this one leaks personal data.
--
-- So the phone lives in its own owner-read-only table, and nothing in the
-- app publishes it to another member. See the "Sharing" note below.
--
-- ============ Why the consent log is append-only ============
--
-- Article 7(1) GDPR puts the burden of proof on the controller: Pinpals
-- must be able to DEMONSTRATE that a member consented. A boolean
-- `accepted_terms` column proves almost nothing — it cannot say which
-- version of which document was accepted, when, or that the text has not
-- been edited since. This table stores all of that, and stores it in a
-- shape that cannot be quietly rewritten:
--
--   * one row per consent event, never updated in place;
--   * the document's version string AND a SHA-256 of its rendered content
--     (computed by src/lib/legal/hash.ts from the same source the member
--     was shown), so a later edit to the text is detectable rather than
--     silently retroactive;
--   * no UPDATE policy and no DELETE policy at all — not "restricted to
--     staff", absent. Nothing reachable through PostgREST can alter a
--     consent record. Withdrawal is a NEW row with `granted = false`,
--     which is also what a regulator expects to see.
--
-- The current state of any consent is therefore derived, never stored:
-- see the `member_current_consents` view at the bottom.
--
-- A row survives account deletion only as long as the profile does — the
-- FK cascades. That is a deliberate trade-off in favour of the erasure
-- right (Art. 17) over indefinite record-keeping; if Pinpals later needs
-- to retain proof of agreement past deletion, that is a retention decision
-- for the Privacy Policy first and a schema change second, not something
-- to smuggle in here.
--
-- ============ Not enforced here: a minimum age ============
--
-- 0059 flagged that no minimum age had ever been decided. It now has: 18,
-- recorded as an `age_18_declaration` consent event at sign-up. This is a
-- self-declaration, not verification — the Terms say so in as many words,
-- and no CHECK constraint here could make it anything else.
--
-- Rollback:
--   drop view if exists public.member_current_consents;
--   drop table if exists public.member_consent_events cascade;
--   drop table if exists public.member_private_details cascade;
--   -- and restore handle_new_user() from 0001_init.sql.

-- ============ member_consent_events ============

create table if not exists public.member_consent_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,

  -- Kept in step with CONSENT_TYPES in src/lib/consent.ts. The four
  -- document types carry a version and hash; the two others do not.
  consent_type text not null check (
    consent_type in (
      'terms',
      'privacy',
      'marketplace_rules',
      'community_guidelines',
      'age_18_declaration',
      'marketing_email'
    )
  ),

  -- false is a withdrawal. Only ever meaningful for 'marketing_email' in
  -- practice — withdrawing agreement to the Terms is closing the account,
  -- not toggling a row — but the column is not restricted to it, because a
  -- consent log that cannot express "no" is not a log.
  granted boolean not null,

  -- Null for the non-document consents. Not a foreign key: the documents
  -- live in the repo (src/lib/legal/), which is what makes them reviewable
  -- in git and impossible to edit from an admin screen. Storing the version
  -- and hash as plain text means shipping a new version of a document is a
  -- code change and nothing more — no migration, no CMS, no seed drift.
  document_version text,
  content_sha256 text check (content_sha256 is null or content_sha256 ~ '^[0-9a-f]{64}$'),

  -- Where the member did this. 'signup' rows are written by
  -- handle_new_user() below, before the member has ever had a session.
  source text not null check (source in ('signup', 'dashboard', 're_acceptance', 'admin')),

  -- Evidence, per Art. 7(1). Both are captured server-side in the Server
  -- Action, never sent by the browser. `inet` rather than text so a
  -- malformed value fails loudly at write time.
  ip_address inet,
  user_agent text,

  occurred_at timestamptz not null default now()
);

alter table public.member_consent_events enable row level security;

-- A member can read their own consent history — that is what
-- /dashboard/legal renders, and being able to see it is itself part of
-- the transparency obligation.
drop policy if exists "members view their own consent events" on public.member_consent_events;
create policy "members view their own consent events"
  on public.member_consent_events for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "staff view consent events" on public.member_consent_events;
create policy "staff view consent events"
  on public.member_consent_events for select
  to authenticated
  using (public.is_staff());

-- A member can only ever append a row about themselves.
drop policy if exists "members record their own consent" on public.member_consent_events;
create policy "members record their own consent"
  on public.member_consent_events for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

-- Deliberately NO update policy and NO delete policy. RLS denies by
-- default, so their absence is the enforcement; the explicit REVOKEs below
-- say the same thing loudly enough that nobody adds one by reflex later.
revoke update, delete on public.member_consent_events from authenticated;
revoke all on public.member_consent_events from anon;

create index if not exists member_consent_events_lookup_idx
  on public.member_consent_events (user_id, consent_type, occurred_at desc);

-- ============ member_current_consents ============
-- The latest event per (member, consent type). `security_invoker = on` —
-- the OPPOSITE of member_age_bands (0059), and for the opposite reason:
-- that view deliberately publishes a narrowed fact about other members,
-- this one must never show a member anyone's consents but their own, so it
-- runs with the caller's rights and inherits the base table's policies.
create or replace view public.member_current_consents
  with (security_invoker = on)
  as
  select distinct on (user_id, consent_type)
    user_id,
    consent_type,
    granted,
    document_version,
    content_sha256,
    occurred_at
  from public.member_consent_events
  order by user_id, consent_type, occurred_at desc;

revoke all on public.member_current_consents from anon;
grant select on public.member_current_consents to authenticated;

-- ============ member_private_details ============
-- The private counterpart to `profiles`. Anything here is between the
-- member and Pinpals; nothing here is published to other members.
--
-- Sharing: there is deliberately no mechanism, view or policy that
-- releases a phone number to another member — not even to someone the
-- member has confirmed a tee time with. If that becomes a feature it needs
-- its own narrow SECURITY DEFINER view, its own opt-in column, and a line
-- in the Privacy Policy describing the disclosure. Until all three exist,
-- the honest position (and the one the sign-up form states) is that the
-- number is used by Pinpals only.
create table if not exists public.member_private_details (
  user_id uuid primary key references public.profiles (id) on delete cascade,

  -- E.164, normalised by normalisePhone() in src/lib/phone.ts before it
  -- ever reaches here. The CHECK is the backstop, not the validation: it
  -- rejects anything that is not a plausible international number, so a
  -- future call site that forgets to normalise fails at the database
  -- rather than storing "087 123 4567 (mobile)".
  phone_e164 text check (phone_e164 is null or phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),

  -- Free-choice answer to "how did you hear about us", from a fixed list
  -- in src/lib/consent.ts. Kept private because there is no reason for it
  -- to be otherwise, not because it is sensitive.
  signup_referral_source text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.member_private_details enable row level security;

drop trigger if exists member_private_details_set_updated_at on public.member_private_details;
create trigger member_private_details_set_updated_at
  before update on public.member_private_details
  for each row
  execute function public.set_updated_at();

drop policy if exists "members view their own private details" on public.member_private_details;
create policy "members view their own private details"
  on public.member_private_details for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "staff view private details" on public.member_private_details;
create policy "staff view private details"
  on public.member_private_details for select
  to authenticated
  using (public.is_staff());

drop policy if exists "members set their own private details" on public.member_private_details;
create policy "members set their own private details"
  on public.member_private_details for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "members update their own private details" on public.member_private_details;
create policy "members update their own private details"
  on public.member_private_details for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "members delete their own private details" on public.member_private_details;
create policy "members delete their own private details"
  on public.member_private_details for delete
  to authenticated
  using ((select auth.uid()) = user_id);

revoke all on public.member_private_details from anon;

-- ============ handle_new_user(), extended ============
--
-- Why the consent rows are written HERE and not in the Server Action:
-- `supabase.auth.signUp()` creates the auth.users row immediately, but the
-- member has no session until they click the confirmation link. A Server
-- Action therefore cannot insert a row that passes
-- `auth.uid() = user_id` — there is no `auth.uid()` yet. Waiting until
-- after confirmation would mean an account existing for hours or days with
-- no record of what its owner agreed to, and no record at all if they
-- never confirm.
--
-- So the Action puts the consent payload in `raw_user_meta_data` (written
-- server-side, from validated form input — the browser never composes it)
-- and this SECURITY DEFINER trigger unpacks it in the same transaction
-- that creates the user. Consent and account come into existence together
-- or not at all.
--
-- Everything below is defensive about missing metadata: a user created by
-- an admin, by a Supabase dashboard invite, or by any flow that predates
-- this migration must still get a profile. A sign-up that has no consent
-- payload produces no consent rows rather than an error, and the sign-up
-- form is what guarantees the payload is there for real members.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  consents jsonb := meta->'consents';
  consent jsonb;
  phone text := nullif(trim(meta->>'phone_e164'), '');
  referral text := nullif(trim(meta->>'signup_referral_source'), '');
  ip text := nullif(trim(meta->>'signup_ip'), '');
begin
  -- Outside the exception block below on purpose: the profile row is the
  -- one thing the rest of the app assumes always exists, so a failure here
  -- must still abort the whole insert exactly as it did before this
  -- migration. Only the additions are made non-fatal.
  insert into public.profiles (id, first_name, last_name)
  values (
    new.id,
    coalesce(meta->>'first_name', 'New'),
    coalesce(meta->>'last_name', 'Golfer')
  );

  begin
  if phone is not null or referral is not null then
    insert into public.member_private_details (user_id, phone_e164, signup_referral_source)
    values (new.id, phone, referral);
  end if;

  -- `consents` is an array of objects shaped by recordedConsentsFor() in
  -- src/app/signup/actions.ts. Iterated rather than unpacked field by
  -- field so that adding a document to the sign-up set is a change in one
  -- place (the registry in src/lib/legal/index.ts) and not here.
  if consents is not null and jsonb_typeof(consents) = 'array' then
    for consent in select * from jsonb_array_elements(consents)
    loop
      insert into public.member_consent_events (
        user_id, consent_type, granted, document_version, content_sha256,
        source, ip_address, user_agent
      )
      values (
        new.id,
        consent->>'type',
        coalesce((consent->>'granted')::boolean, false),
        nullif(consent->>'version', ''),
        nullif(consent->>'sha256', ''),
        'signup',
        -- A malformed forwarded-for value must not take the sign-up down
        -- with it; an unrecorded IP is a weaker audit trail, a failed
        -- INSERT here is a member who cannot create an account.
        case when ip ~ '^[0-9a-fA-F:.]+$' then ip::inet else null end,
        nullif(meta->>'signup_user_agent', '')
      );
    end loop;
  end if;
  exception
    when others then
      -- If the consent or contact writes fail for any reason, log it and
      -- let the account be created: a member locked out of sign-up by a
      -- bad user-agent string is a worse outcome than a consent row that
      -- has to be re-captured at next login — which /dashboard/legal
      -- already prompts for, since a missing row and a stale version are
      -- the same state to it.
      raise warning 'handle_new_user: post-profile setup failed for %: %', new.id, sqlerrm;
  end;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();
