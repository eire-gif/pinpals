-- Pinpals News, phase 1: where articles come from, and what was actually
-- published at the source.
--
-- Two tables. `content_sources` is the list of press offices we poll.
-- `content_items` is what came back, stored exactly as it arrived.
--
-- Three things here are deliberate and worth not undoing later.
--
-- 1. `content_items.raw_body` holds the UNTOUCHED response body — the bytes
--    the server sent, before any parsing, cleaning or summarising. It is not
--    a convenience copy. A later phase drafts articles from it and then
--    verifies every quote in the draft word-for-word against it, so if
--    anything between the wire and this column rewrites the text, that check
--    silently starts comparing a draft against a paraphrase and passes
--    fabricated quotes. A prototype run hit exactly this: the fetcher used
--    summarised the feed, and quotes survived while prose did not. Store the
--    bytes, parse afterwards.
--
--    It is also the evidence trail. If a story is ever disputed, this column
--    plus `fetched_at` is what shows what the source actually said and when
--    we read it.
--
-- 2. `image_rights_granted` cannot be true without `rights_evidence_url`,
--    enforced by a check constraint rather than by application discipline.
--    Press-release photographs are, at every source surveyed, licensed for
--    editorial use by accredited media only — they are not open assets.
--    Pinpals holds no such accreditation with anyone today, so this flag is
--    false everywhere and the site renders typographic plates instead. When
--    a press office does grant rights by email, the link to that email is
--    the thing that makes the flag settable. No evidence, no flag, no
--    photograph.
--
-- 3. New sources start with `enabled = false`. Adding a row does not begin
--    fetching. Someone has to look at the source, confirm robots.txt allows
--    it and its terms don't forbid automated access, and turn it on.
--
-- Both tables are staff-read-only and have no client write path at all.
-- Rows are written exclusively by the service-role client from the collector
-- route, the same shape as admin_user_notes (0013) and admin_audit_log.
--
-- Rollback:
--   drop table if exists public.content_items cascade;
--   drop table if exists public.content_sources cascade;

-- ============ content_sources ============

create table if not exists public.content_sources (
  id bigint generated always as identity primary key,

  name text not null check (char_length(trim(name)) > 0),
  organisation text not null check (char_length(trim(organisation)) > 0),

  -- Only tier A — a first-party press office of the organisation the news is
  -- about. Journalism and commentary sites are deliberately not
  -- representable here: an article written from another publication's
  -- write-up tracks that publication's structure and angle even when no
  -- sentence matches, which is the derivative-work risk this whole design
  -- exists to avoid. If a tier B tier is ever added it is for link-only
  -- round-ups, and it needs its own review, not a widened check constraint.
  tier text not null default 'A' check (tier in ('A')),

  fetch_kind text not null check (fetch_kind in ('rss', 'atom', 'html', 'pdf_index')),
  feed_url text not null check (feed_url like 'https://%'),
  newsroom_url text not null check (newsroom_url like 'https://%'),
  terms_url text,

  -- Off until a human has checked the source. See note 3 above.
  enabled boolean not null default false,

  -- robots.txt outcome, cached so a fetch run doesn't re-request it every
  -- time. `robots_allows = false` blocks the fetch; null means unchecked,
  -- which also blocks it. Only true permits a fetch.
  robots_checked_at timestamptz,
  robots_allows boolean,

  -- See note 2 above.
  image_rights_granted boolean not null default false,
  rights_evidence_url text,

  poll_interval_minutes integer not null default 360
    check (poll_interval_minutes between 15 and 10080),

  last_fetched_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  consecutive_failures integer not null default 0 check (consecutive_failures >= 0),

  -- 'degraded' is set by the collector after repeated failures so a broken
  -- feed surfaces in admin instead of failing silently for a month.
  -- 'blocked' means robots.txt or the source's terms say no; it is a
  -- deliberate, sticky state and the collector never clears it on its own.
  status text not null default 'healthy'
    check (status in ('healthy', 'degraded', 'blocked', 'disabled')),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint content_sources_feed_url_key unique (feed_url),
  constraint content_sources_image_rights_need_evidence_check
    check (image_rights_granted = false or rights_evidence_url is not null)
);

-- The collector's own query: enabled, allowed, and due a poll.
create index if not exists content_sources_due_idx
  on public.content_sources (enabled, status, last_fetched_at);

drop trigger if exists content_sources_set_updated_at on public.content_sources;
create trigger content_sources_set_updated_at
  before update on public.content_sources
  for each row
  execute function public.set_updated_at();

alter table public.content_sources enable row level security;

-- Read-only for any active staff member. There is nothing member-facing
-- here — a source row is operational plumbing, and `last_error` can carry
-- upstream server messages we would rather not put in front of the public.
drop policy if exists "Staff can view content sources" on public.content_sources;
create policy "Staff can view content sources"
  on public.content_sources for select
  to authenticated
  using (public.is_staff());

-- No insert/update/delete policy for any role. Rows are written only by the
-- service-role client, which bypasses RLS. Revoke explicitly rather than
-- relying on "no policy = no access": 0008 and 0010 both found Supabase's
-- default grants broader than that, so this bakes the fix in from the start.
revoke insert, update, delete, truncate, references, trigger
  on public.content_sources from anon;
revoke insert, update, delete, truncate, references, trigger
  on public.content_sources from authenticated;
revoke select on public.content_sources from anon;

-- ============ content_items ============

create table if not exists public.content_items (
  id bigint generated always as identity primary key,

  source_id bigint not null
    references public.content_sources (id) on delete cascade,

  -- The feed's own guid where it has one, otherwise a sha256 of the
  -- canonical URL. Paired with source_id this is what makes a re-poll a
  -- no-op rather than a duplicate.
  external_id text not null check (char_length(trim(external_id)) > 0),

  canonical_url text not null check (canonical_url like 'https://%'),
  title text not null check (char_length(trim(title)) > 0),
  published_at timestamptz,
  fetched_at timestamptz not null default now(),

  -- The untouched response body. See note 1 at the top of this file. Not
  -- nullable, because an item we could not read the body of is not an item
  -- we can safely draft from.
  raw_body text not null,

  -- sha256 of raw_body. A source that reissues the same item with edits
  -- gets a new hash, which is how an updated release is noticed without
  -- diffing text on every poll.
  content_hash text not null check (char_length(content_hash) = 64),

  -- Populated in phase 2 by the triage model. Null means not yet scored.
  triage_score smallint check (triage_score between 0 and 100),
  triage_reason text,
  triage_model text,
  triaged_at timestamptz,

  status text not null default 'new'
    check (status in ('new', 'triaged', 'rejected', 'drafted', 'error')),
  error_detail text,

  created_at timestamptz not null default now(),

  constraint content_items_source_external_id_key unique (source_id, external_id)
);

-- The triage queue: unscored items, newest first.
create index if not exists content_items_status_fetched_idx
  on public.content_items (status, fetched_at desc);

-- The drafting queue: scored items, best first.
create index if not exists content_items_status_score_idx
  on public.content_items (status, triage_score desc);

create index if not exists content_items_source_id_idx
  on public.content_items (source_id);

alter table public.content_items enable row level security;

-- Staff-read-only, and deliberately not public. These rows are other
-- organisations' press releases held in full. We publish our own articles
-- written from them, with attribution and a link — we do not republish the
-- releases themselves, and a public select policy here would do exactly
-- that by the back door.
drop policy if exists "Staff can view content items" on public.content_items;
create policy "Staff can view content items"
  on public.content_items for select
  to authenticated
  using (public.is_staff());

revoke insert, update, delete, truncate, references, trigger
  on public.content_items from anon;
revoke insert, update, delete, truncate, references, trigger
  on public.content_items from authenticated;
revoke select on public.content_items from anon;

-- ============ seed: the two verified launch sources ============
--
-- Both were verified by fetch in September 2026. USGA's media centre returns
-- 404 for robots.txt, which by convention means everything is allowed; CPG
-- is WordPress and disallows only /wp-admin/, so /feed/ is permitted. Even
-- so, both land with robots_allows null and enabled false — the collector
-- checks robots.txt itself on first run, and a human turns the source on.
--
-- Deliberately NOT seeded, and worth recording why:
--   Titleist (pr.co)  advertises an Atom feed that its own robots.txt
--                     disallows. Do not poll it. Ask Acushnet instead.
--   TaylorMade        failed TLS negotiation on automated access.
--   Golf Ireland      JS-rendered on the DotGolf platform; not pollable
--                     without a headless browser. Ask them for a feed.
--   Augusta National  no public newsroom, and historically the most
--                     rights-protective organisation in the sport.

insert into public.content_sources
  (name, organisation, fetch_kind, feed_url, newsroom_url, poll_interval_minutes)
values
  (
    'USGA Media Center',
    'United States Golf Association',
    'rss',
    'https://mediacenter.usga.org/press-releases?pagetemplate=rss',
    'https://mediacenter.usga.org/press-releases',
    720
  ),
  (
    'Confederation of Professional Golf',
    'Confederation of Professional Golf',
    'rss',
    'https://cpg.golf/feed/',
    'https://cpg.golf/category/news/',
    360
  )
on conflict (feed_url) do nothing;
