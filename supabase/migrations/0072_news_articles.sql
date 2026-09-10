-- Pinpals News, phase 2: the articles themselves.
--
-- Four tables. `articles` is what a member reads, `article_images` records
-- where every picture came from and under what licence, `article_revisions`
-- is the edit trail, and `news_usage` is the money.
--
-- Four decisions here are load-bearing.
--
-- 1. `publish_mode` is stamped on each article at creation, not read from the
--    environment when the page renders. The site's AI disclosure derives its
--    prominence from this column (see src/components/news/ai-disclosure.tsx),
--    because EU AI Act Article 50(4) exempts content that had genuine human
--    editorial control and does not exempt content that published itself.
--    Storing the mode per article means the history stays truthful after
--    someone later flips NEWS_PUBLISH_MODE: an article reviewed by a person
--    in 2026 does not retroactively become an unreviewed one.
--
--    The `published_needs_provenance` constraint enforces the pairing. A
--    published article is either human-reviewed, with a reviewer and a
--    timestamp, or it is explicitly marked auto. There is no third state, and
--    in particular there is no way to have a published article that claims
--    review it never had.
--
-- 2. `quotes` is stored as jsonb alongside the body, not merely embedded in
--    the prose. Every quote was checked word-for-word against
--    content_items.raw_body before the row was written; keeping them as
--    structured data means the check can be re-run later against the stored
--    source, and the admin queue can show a reviewer which quotes were
--    verified rather than asking them to take it on faith.
--
-- 3. `article_images.licence` and `.credit` are both NOT NULL, and
--    `image_source = 'licensed_press'` is refused unless the article's source
--    has recorded image rights. Press photographs are licensed to accredited
--    media, not open assets. Pinpals holds no accreditation with anyone, so
--    today this means articles carry typographic plates instead — which is a
--    design decision the site already makes look deliberate.
--
-- 4. `news_usage` logs tokens and computed cost per model call. Not for
--    curiosity: the pipeline halts when the month's spend crosses its budget,
--    and it cannot halt on a number it does not record.
--
-- Rollback:
--   drop table if exists public.news_usage cascade;
--   drop table if exists public.article_revisions cascade;
--   drop table if exists public.article_images cascade;
--   drop table if exists public.articles cascade;

-- ============ articles ============

create table if not exists public.articles (
  id bigint generated always as identity primary key,

  -- Nullable only so an article can outlive a purge of its source item.
  -- Every article the pipeline writes has one.
  content_item_id bigint references public.content_items (id) on delete set null,

  slug text not null unique
    check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 120),
  headline text not null check (char_length(trim(headline)) between 1 and 120),
  standfirst text not null check (char_length(trim(standfirst)) between 1 and 400),
  body_md text not null check (char_length(trim(body_md)) > 0),

  -- The differentiator. Nullable, but a null one is a weak publish candidate:
  -- if an announcement changes nothing for a club golfer in Ireland, it
  -- probably should not run.
  irish_angle text,

  source_attribution text not null check (char_length(trim(source_attribution)) > 0),
  source_organisation text not null check (char_length(trim(source_organisation)) > 0),
  source_url text not null check (source_url like 'https://%'),

  -- [{ "text": "...", "speaker": "..." }] — each verified verbatim against
  -- content_items.raw_body before this row was written. See note 2.
  quotes jsonb not null default '[]'::jsonb
    check (jsonb_typeof(quotes) = 'array'),

  ai_generated boolean not null default true,
  ai_model text,
  prompt_version text,

  human_reviewed_by uuid references auth.users (id) on delete set null,
  human_reviewed_at timestamptz,
  review_notes text,

  status text not null default 'draft'
    check (status in ('draft', 'approved', 'published', 'rejected', 'retracted', 'error')),

  -- See note 1.
  publish_mode text not null check (publish_mode in ('review', 'auto')),

  published_at timestamptz,
  retracted_at timestamptz,
  retraction_reason text,
  correction_note text,

  -- Why a draft was refused: a fabricated quote, an over-long extract, a
  -- banned-content match. Kept so the prompts can be tuned against real
  -- failures rather than guesses.
  validation_errors jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint published_needs_provenance check (
    status <> 'published'
    or (publish_mode = 'review'
        and human_reviewed_by is not null
        and human_reviewed_at is not null)
    or publish_mode = 'auto'
  ),
  constraint published_needs_timestamp check (
    status <> 'published' or published_at is not null
  ),
  constraint retracted_needs_reason check (
    status <> 'retracted' or retraction_reason is not null
  )
);

-- The public list: published, newest first.
create index if not exists articles_published_idx
  on public.articles (published_at desc)
  where status = 'published';

-- The admin queue: drafts, oldest first.
create index if not exists articles_status_created_idx
  on public.articles (status, created_at);

create index if not exists articles_content_item_id_idx
  on public.articles (content_item_id);

drop trigger if exists articles_set_updated_at on public.articles;
create trigger articles_set_updated_at
  before update on public.articles
  for each row
  execute function public.set_updated_at();

alter table public.articles enable row level security;

-- Published articles are public. Nothing else is: a draft is unreviewed
-- machine output, and a rejected one may be rejected precisely because it
-- said something wrong about a named person.
drop policy if exists "Published articles are public" on public.articles;
create policy "Published articles are public"
  on public.articles for select
  to public
  using (status = 'published');

drop policy if exists "Staff can view all articles" on public.articles;
create policy "Staff can view all articles"
  on public.articles for select
  to authenticated
  using (public.is_staff());

revoke insert, update, delete, truncate, references, trigger
  on public.articles from anon;
revoke insert, update, delete, truncate, references, trigger
  on public.articles from authenticated;

-- ============ article_images ============

create table if not exists public.article_images (
  id bigint generated always as identity primary key,
  article_id bigint not null references public.articles (id) on delete cascade,

  url text check (url is null or url like 'https://%'),
  storage_path text,

  image_source text not null
    check (image_source in ('own', 'licensed_press', 'stock', 'none')),

  -- Both required. An image whose licence or credit we cannot state is an
  -- image we do not publish. See note 3.
  licence text not null check (char_length(trim(licence)) > 0),
  licence_url text,
  credit text not null check (char_length(trim(credit)) > 0),
  photographer text,
  source_url text,
  rights_evidence_url text,

  obtained_at timestamptz not null default now(),

  constraint article_images_need_a_location check (
    image_source = 'none' or url is not null or storage_path is not null
  )
);

create index if not exists article_images_article_id_idx
  on public.article_images (article_id);

-- `licensed_press` requires the article's source to have recorded image
-- rights. Enforced by trigger because the check spans two tables, which a
-- CHECK constraint cannot express. Deliberately not left to application code:
-- this is the rule most likely to be quietly broken by a future change.
create or replace function public.validate_article_image()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_granted boolean;
begin
  if new.image_source <> 'licensed_press' then
    return new;
  end if;

  select cs.image_rights_granted
    into v_granted
    from public.articles a
    join public.content_items ci on ci.id = a.content_item_id
    join public.content_sources cs on cs.id = ci.source_id
   where a.id = new.article_id;

  if v_granted is distinct from true then
    raise exception
      'article_images: image_source ''licensed_press'' requires recorded image rights on the source (article %)',
      new.article_id
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists article_images_validate on public.article_images;
create trigger article_images_validate
  before insert or update on public.article_images
  for each row
  execute function public.validate_article_image();

alter table public.article_images enable row level security;

drop policy if exists "Images of published articles are public" on public.article_images;
create policy "Images of published articles are public"
  on public.article_images for select
  to public
  using (
    exists (
      select 1 from public.articles a
       where a.id = article_images.article_id
         and a.status = 'published'
    )
  );

drop policy if exists "Staff can view all article images" on public.article_images;
create policy "Staff can view all article images"
  on public.article_images for select
  to authenticated
  using (public.is_staff());

revoke insert, update, delete, truncate, references, trigger
  on public.article_images from anon;
revoke insert, update, delete, truncate, references, trigger
  on public.article_images from authenticated;

-- ============ article_revisions ============

create table if not exists public.article_revisions (
  id bigint generated always as identity primary key,
  article_id bigint not null references public.articles (id) on delete cascade,
  editor_id uuid references auth.users (id) on delete set null,
  before jsonb not null,
  after jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists article_revisions_article_created_idx
  on public.article_revisions (article_id, created_at desc);

alter table public.article_revisions enable row level security;

drop policy if exists "Staff can view article revisions" on public.article_revisions;
create policy "Staff can view article revisions"
  on public.article_revisions for select
  to authenticated
  using (public.is_staff());

revoke insert, update, delete, truncate, references, trigger
  on public.article_revisions from anon;
revoke insert, update, delete, truncate, references, trigger
  on public.article_revisions from authenticated;
revoke select on public.article_revisions from anon;

-- ============ news_usage ============

create table if not exists public.news_usage (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  stage text not null check (stage in ('triage', 'draft')),
  model text not null,
  input_tokens integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  -- Micro-dollars, so spend can be summed in integers rather than accumulating
  -- float error across thousands of small calls.
  cost_microdollars bigint not null default 0 check (cost_microdollars >= 0),
  content_item_id bigint references public.content_items (id) on delete set null
);

create index if not exists news_usage_occurred_at_idx
  on public.news_usage (occurred_at desc);

alter table public.news_usage enable row level security;

drop policy if exists "Staff can view news usage" on public.news_usage;
create policy "Staff can view news usage"
  on public.news_usage for select
  to authenticated
  using (public.is_staff());

revoke insert, update, delete, truncate, references, trigger
  on public.news_usage from anon;
revoke insert, update, delete, truncate, references, trigger
  on public.news_usage from authenticated;
revoke select on public.news_usage from anon;

-- ============ seed: the three articles already live on /news ============
--
-- These shipped in src/lib/news/seed-articles.ts because the articles table
-- did not exist yet. This migration is where that stops being true, so they
-- move into the database and the seed file goes away — otherwise pointing
-- /news at the database would empty a page that is currently live.
--
-- Each was drafted by hand from a single CPG press release and validated the
-- same way the pipeline validates: every quote appears word-for-word in the
-- source, and no passage runs more than 25 consecutive words from it outside
-- a marked quote. content_item_id is resolved from the collected item with
-- the matching canonical_url, so each article points at the stored press
-- release it was written from.
--
-- publish_mode 'review' and a null human_reviewed_by would violate
-- published_needs_provenance, so these are seeded as 'auto': nobody clicked
-- approve in an admin queue that did not exist. That is the honest record,
-- and it is exactly the case the constraint is there to force.

insert into public.articles (
  content_item_id, slug, headline, standfirst, body_md, irish_angle,
  source_attribution, source_organisation, source_url, quotes,
  ai_generated, ai_model, status, publish_mode, published_at
)
select
  ci.id,
  v.slug, v.headline, v.standfirst, v.body_md, v.irish_angle,
  v.source_attribution, 'Confederation of Professional Golf', v.source_url,
  v.quotes::jsonb,
  true, 'claude-sonnet-5', 'published', 'auto', v.published_at::timestamptz
from (values
  (
    'junior-ryder-cup-returns-to-ireland-2027',
    'Junior Ryder Cup returns to Ireland with Gallacher as captain',
    'Ballyneety and Adare Manor will host the 2027 matches, with Stephen Gallacher leading Europe for a record third time.',
    $body$Ballyneety Golf Club will stage two days of international team golf next September. The Confederation of Professional Golf has confirmed Stephen Gallacher as European Captain for the 2027 Junior Ryder Cup, with matches running from 14 to 16 September and the closing singles moving to Adare Manor on the eve of the Ryder Cup itself.

For Gallacher it is a third captaincy, a European record. He led the side in Rome in 2023, where Europe won by 11 points and ended a 17-year wait, and again in New York last year, where the United States took the trophy by 17 and a half points to 12 and a half. A second win would put him alongside Macarena Campomanes and Andy Ingram as the only captains to manage it.

Each team is made up of twelve players, six boys and six girls. The event has run since 1997, and its alumni list is the reason clubs pay attention. Rory McIlroy, Nicolai Højgaard and Nicolas Colsaerts all played in it before going on to win Ryder Cups. Leona Maguire represented Europe in 2008 and has since taken 8.5 points from three Solheim Cup appearances.

Gallacher, 51, won four DP World Tour titles and played under Paul McGinley at Gleneagles in 2014. He set up a foundation supporting junior golf in Scotland and received an MBE in 2024.$body$,
    $angle$Two of the three days are at Ballyneety, a members' club rather than a resort course, which is unusual for an event of this level. Any Irish junior in a club programme now has a home tie to aim at, and Maguire's route from the 2008 team is the example.$angle$,
    'Confederation of Professional Golf, 25 June 2026',
    'https://cpg.golf/news/ryder-cup/stephen-gallacher-named-2027-european-junior-ryder-cup-captain/',
    $q$[{"text":"The Junior Ryder Cup returning to the Island of Ireland for the first time since 2002 is extremely exciting.","speaker":"Stephen Gallacher, 2027 European Junior Ryder Cup Captain"}]$q$,
    '2026-09-10T08:00:00+01:00'
  ),
  (
    'molinari-vice-captain-2027-ryder-cup-adare-manor',
    'Molinari returns as vice captain for Adare Manor',
    'Luke Donald has named the Italian as his first vice captain for 2027, a role he has held at the last two Ryder Cups.',
    $body$Luke Donald has appointed Edoardo Molinari as his first vice captain for the 2027 Ryder Cup, to be played at Adare Manor in Limerick from 13 to 19 September 2027. It is the third Ryder Cup running in which Molinari has held the role, after European wins at Marco Simone in 2023 and Bethpage last year.

The job is a specific one. Molinari, 45, supplies statistical support to Donald and the team through his own analysis model, work that feeds into the qualification system as much as the week itself.

He played in the 2010 Ryder Cup in Wales alongside his brother Francesco, the pair becoming the first brothers to face the United States since Bernard and Geoffrey Hunt in 1963. They halved their fourballs against Stewart Cink and Matt Kuchar, and Edoardo took a half point from his singles with Rickie Fowler as Europe won by a single point. He has three DP World Tour wins, was Challenge Tour Number One in 2009, and won the US Amateur in 2005.

Donald was direct about why the appointment was straightforward, calling Molinari a major factor in the backroom team.

The 2027 matches mark the 100th anniversary of the Ryder Cup.$body$,
    $angle$The home team gets to set up the course, and Donald has said explicitly that this is an edge Molinari looks at. How Adare Manor is presented in September 2027 will be a deliberate decision, and it is the kind of detail worth watching for anyone who follows course setup at their own club.$angle$,
    'Confederation of Professional Golf, 2 April 2026',
    'https://cpg.golf/news/ryder-cup/edoardo-molinari-named-vice-captain-for-the-2027-ryder-cup/',
    $q$[{"text":"Every time we play in an Irish Open or anything really in Ireland, they're always very passionate, very loud.","speaker":"Edoardo Molinari, 2027 European Ryder Cup Vice Captain"},{"text":"Edoardo has been a rock of support to me.","speaker":"Luke Donald, European Ryder Cup Captain"}]$q$,
    '2026-09-10T08:05:00+01:00'
  ),
  (
    'incremental-play-womens-golf-retention-research',
    'Research puts a number on women''s golf retention',
    'A webinar attended by Golf Ireland heard that incremental play lifts weekly participation among women by 54 per cent.',
    $body$A survey of 419 women who had been through the Operation 36 programme in the United States and Canada found that introducing incremental play raised the number playing and practising weekly by 54 per cent. The figure was presented at a Golf Genius webinar attended by 267 people from 21 countries.

Golf Ireland was among the governing bodies represented, alongside The R&A, Scottish Golf, England Golf, Golf Australia and the Japan Golf Association. So were 132 golf clubs. The panel included Molly Moore and Alistair Spink of love.golf, Matt Reagan of Operation 36 and Mark Smith of Stamford Golf Club, who between them have helped create 240,000 new participants worldwide, 96,000 of them women and girls.

The more uncomfortable numbers came from a live poll of the people watching. Just under half said their organisation had a target for increasing female participation. Twenty-three per cent said they ran no women's or girls' programmes at all. Forty-four per cent were tracking whatever they did run on manual workflows, with only five per cent using a dedicated participation dashboard.

The session covered three themes: the part experiences play in building a habit, the coach as the anchor of a community, and how incremental learning drives retention.$body$,
    $angle$The 23 per cent figure is the one to sit with. If roughly one in four organisations at a webinar about women's golf runs no programme for women, the number across clubs that did not attend is unlikely to be better. It is a fair question to put to your own committee.$angle$,
    'Confederation of Professional Golf, 27 August 2026',
    'https://cpg.golf/news/golf-genius-webinar-highlights-opportunity-for-industry-to-build-on-rise-in-girls-and-womens-golf/',
    $q$[{"text":"If golf is going to grow sustainably, we need to create great experiences that attract more women and girls and give them reasons to keep coming back.","speaker":"Aston Ward, Chief Operating Officer, Confederation of Professional Golf"}]$q$,
    '2026-09-10T08:10:00+01:00'
  )
) as v (slug, headline, standfirst, body_md, irish_angle,
        source_attribution, source_url, quotes, published_at)
left join public.content_items ci on ci.canonical_url = v.source_url
on conflict (slug) do nothing;
