-- Pinpals News: collecting from newsrooms that publish a sitemap, not a feed.
--
-- The two press offices that matter most to an Irish club golfer — Ryder Cup
-- Europe and the DP World Tour — publish no RSS at all. What they publish is
-- a Google News sitemap: an XML list of article URLs carrying the
-- publisher's own title and publication date per entry. That is a better
-- index than most feeds. It is also only an index, so collecting from one
-- means fetching each article page, which is a different kind of request
-- from polling a feed and needs its own limits.
--
-- Two columns carry those limits, and both are deliberately data rather than
-- code so they can be tightened for one source without a deploy.
--
-- 1. `section_prefix` is a plain URL prefix — not a pattern, not a regex. An
--    article URL must start with it or it is never fetched. This exists
--    because a sitemap is site-wide: the DP World Tour's lists
--    /dpworld-tour/, /european-tour/ and /legends-tour/, and its own
--    robots.txt disallows the second and third. The collector checks
--    robots.txt against every article URL as well, so this is the second of
--    two locks, not the only one. A regex here would be a way to make the
--    collector fetch something nobody intended; a prefix cannot be.
--
-- 2. `max_articles_per_run` caps how many article pages one source may
--    request in a single run. With a ten-second gap between requests and a
--    six-hourly schedule, eight is roughly the daily volume of both
--    newsrooms combined and takes about eighty seconds. Raising it raises
--    someone else's server load, so raise it knowingly.
--
-- Neither source is enabled here. Same rule as migration 0068: adding a row
-- does not begin fetching. A human enables it after reading the first items
-- it collects against the pages they came from — which matters more than
-- usual for these two, because unlike the feed sources their body text is
-- extracted by heuristic rather than handed to us by the publisher.
--
-- Rollback:
--   delete from public.content_sources where fetch_kind = 'sitemap';
--   alter table public.content_sources drop column if exists section_prefix;
--   alter table public.content_sources drop column if exists max_articles_per_run;
--   alter table public.content_sources drop constraint if exists content_sources_fetch_kind_check;
--   alter table public.content_sources add constraint content_sources_fetch_kind_check
--     check (fetch_kind in ('rss', 'atom', 'html', 'pdf_index'));

-- ============ fetch_kind gains 'sitemap' ============

alter table public.content_sources
  drop constraint if exists content_sources_fetch_kind_check;

alter table public.content_sources
  add constraint content_sources_fetch_kind_check
  check (fetch_kind in ('rss', 'atom', 'sitemap', 'html', 'pdf_index'));

-- ============ the two limits ============

alter table public.content_sources
  add column if not exists section_prefix text;

alter table public.content_sources
  add column if not exists max_articles_per_run integer;

-- Must be an https prefix if set at all: a bare path or an http URL would
-- either match nothing or point the collector somewhere it should not go.
alter table public.content_sources
  drop constraint if exists content_sources_section_prefix_check;

alter table public.content_sources
  add constraint content_sources_section_prefix_check
  check (section_prefix is null or section_prefix like 'https://%');

alter table public.content_sources
  drop constraint if exists content_sources_max_articles_per_run_check;

alter table public.content_sources
  add constraint content_sources_max_articles_per_run_check
  check (max_articles_per_run is null or max_articles_per_run between 1 and 25);

-- A sitemap source without a section prefix is legitimate — Ryder Cup
-- Europe's whole news section is one path — but it should be a decision, so
-- it is recorded per row rather than defaulted silently.
comment on column public.content_sources.section_prefix is
  'Sitemap sources: article URLs must start with this exact prefix. Not a pattern. Null means the whole sitemap is in scope.';

comment on column public.content_sources.max_articles_per_run is
  'Sitemap sources: cap on article pages fetched per collection run. Null uses the collector default of 8.';

-- ============ why an item could not be used ============

-- The feed path stores what the publisher sent. The sitemap path stores what
-- the extractor made of a web page, so how it got there is worth keeping:
-- 'json-ld' means the publisher told us, the rest means we inferred it.
alter table public.content_items
  add column if not exists extraction_method text;

alter table public.content_items
  drop constraint if exists content_items_extraction_method_check;

alter table public.content_items
  add constraint content_items_extraction_method_check
  check (
    extraction_method is null
    or extraction_method in ('json-ld', 'article-element', 'main-element', 'density')
  );

comment on column public.content_items.extraction_method is
  'Sitemap sources: how the body text was located in the page. Null for feed sources, which are given the text directly.';

-- ============ the sources ============

-- Ryder Cup Europe.
--
-- robots.txt (read 10 September 2026) disallows only /components/ and /api/,
-- and the site advertises this sitemap itself. The news section is the whole
-- of /news-media/, so no section prefix is needed.
--
-- Images: not granted. Every photograph on the site is credited to an agency
-- and licensed to accredited media. Pinpals holds no accreditation, so
-- image_rights_granted stays false and articles render typographic plates —
-- see migration 0068, note 2.
insert into public.content_sources (
  name, organisation, tier, fetch_kind,
  feed_url, newsroom_url, terms_url,
  enabled, poll_interval_minutes,
  section_prefix, max_articles_per_run
)
values (
  'Ryder Cup Europe — news sitemap',
  'Ryder Cup Europe',
  'A',
  'sitemap',
  'https://www.rydercup.com/sitemap/articles.xml',
  'https://www.rydercup.com/news-media',
  'https://www.rydercup.com/terms-of-use',
  false,
  360,
  'https://www.rydercup.com/news-media/',
  6
)
on conflict (feed_url) do nothing;

-- DP World Tour.
--
-- robots.txt (read 10 September 2026) allows /dpworld-tour/ and disallows
-- /european-tour/, /legends-tour/, /api/ and /search/. The sitemap at
-- /sitemap-article.xml is an INDEX whose children are monthly urlsets plus a
-- 'latest.xml'; the collector follows the two newest children and no deeper.
--
-- The section prefix is what keeps the two disallowed tours out of the
-- queue. robots.txt would refuse them anyway — this stops us asking.
insert into public.content_sources (
  name, organisation, tier, fetch_kind,
  feed_url, newsroom_url, terms_url,
  enabled, poll_interval_minutes,
  section_prefix, max_articles_per_run
)
values (
  'DP World Tour — news sitemap',
  'DP World Tour',
  'A',
  'sitemap',
  'https://www.europeantour.com/sitemap-article.xml',
  'https://www.europeantour.com/dpworld-tour/news/',
  'https://www.europeantour.com/terms-and-conditions/',
  false,
  360,
  'https://www.europeantour.com/dpworld-tour/',
  8
)
on conflict (feed_url) do nothing;

notify pgrst, 'reload schema';
