-- Courses played, bucket lists, course reviews and suggested PinPals.
--
-- Designed on the "PinPals Onboarding Flow" canvas, 4 October 2026, and
-- written up in claude/onboarding-flow-design.md. Four things a new member
-- now does while building their profile, and the one thing Home shows them
-- afterwards:
--
--   1. member_courses      — "courses I've played" and "my bucket list"
--   2. course_reviews      — a 1–5 star rating with an optional comment
--   3. clubs.rating_*      — the summary those reviews roll up to
--   4. profiles.*          — how often they play, what they're up for, and
--                            whether they have been through the builder
--   5. suggested_pinpals() — members at your club and clubs nearby
--
-- `reviews` (0041) is the MARKETPLACE table — a buyer rating a seller after
-- an order. A course review is a different thing with a different subject,
-- different rules and different moderation, and shares nothing with it but
-- the word. Hence course_reviews.
--
-- Rollback:
--   drop function if exists public.suggested_pinpals(integer, numeric);
--   drop trigger if exists course_reviews_rollup on public.course_reviews;
--   drop function if exists public.course_reviews_after_change();
--   drop function if exists public.refresh_club_rating(bigint);
--   drop table if exists public.course_reviews;
--   drop table if exists public.member_courses;
--   alter table public.clubs drop column if exists rating_count,
--     drop column if exists rating_avg, drop column if exists rating_dist;
--   alter table public.profiles drop column if exists play_frequency,
--     drop column if exists play_interests, drop column if exists onboarded_at;
--   -- and restore reports_target_type_check from 0088.

-- ============ 1. member_courses ============
--
-- One table for both lists rather than two, because they are the same shape
-- and a member moves courses between them ("played it at last"): the bucket
-- row is deleted and a played row inserted. A course can legitimately be on
-- both — played once, would happily go back — so uniqueness is per kind.
--
-- Readable by every signed-in member, like profiles. "18 members have played
-- here" and "Niamh has Old Head on her bucket list too" are the point of
-- keeping the lists at all; a private bucket list would be a note to self.

create table if not exists public.member_courses (
  id bigint generated always as identity primary key,
  member_id uuid not null references public.profiles (id) on delete cascade,
  club_id bigint not null references public.clubs (id) on delete cascade,
  kind text not null check (kind in ('played', 'bucket')),
  created_at timestamptz not null default now(),
  unique (member_id, club_id, kind)
);

create index if not exists member_courses_club_kind_idx on public.member_courses (club_id, kind);
create index if not exists member_courses_member_idx on public.member_courses (member_id);

alter table public.member_courses enable row level security;

create policy "member courses are readable by signed-in members"
  on public.member_courses for select to authenticated
  using (true);

create policy "members add to their own course lists"
  on public.member_courses for insert to authenticated
  with check (member_id = (select auth.uid()));

create policy "members remove from their own course lists"
  on public.member_courses for delete to authenticated
  using (member_id = (select auth.uid()));

-- No update policy: a row is a fact ("played", "bucket"), and changing its
-- kind is a delete and an insert, which keeps created_at honest.

-- ============ 2. course_reviews ============
--
-- One review per member per course. A member who goes back and changes
-- their mind edits it; a second row would let one enthusiast or one grudge
-- count twice in the average.
--
-- `hidden_at` is moderation. A hidden review drops out of everyone's view
-- but its author's, and out of the club's average. Members cannot set or
-- clear it themselves — enforced by column privileges below, not by a
-- policy, because a policy cannot say "any column except this one".

create table if not exists public.course_reviews (
  id bigint generated always as identity primary key,
  club_id bigint not null references public.clubs (id) on delete cascade,
  member_id uuid not null references public.profiles (id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  body text check (body is null or char_length(body) <= 1000),
  tags text[] not null default '{}'::text[]
    check (tags <@ array['condition', 'greens', 'views', 'welcome', 'value', 'pace']::text[]),
  -- First of the month it was played. A day would be false precision and
  -- a member asked "what date did you play Lahinch?" makes one up.
  played_month date check (
    played_month is null
    or (extract(day from played_month) = 1 and played_month <= current_date)
  ),
  hidden_at timestamptz,
  hidden_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (club_id, member_id)
);

create index if not exists course_reviews_club_recent_idx
  on public.course_reviews (club_id, created_at desc)
  where hidden_at is null;
create index if not exists course_reviews_member_idx on public.course_reviews (member_id);

drop trigger if exists course_reviews_set_updated_at on public.course_reviews;
create trigger course_reviews_set_updated_at
  before update on public.course_reviews
  for each row execute function public.set_updated_at();

alter table public.course_reviews enable row level security;

-- Signed-in members only, like the profiles a review is shown beside: a
-- review carries a name and a home club. Signed-out visitors to a course page
-- still see the stars, from the summary on `clubs`.
create policy "course reviews are readable by signed-in members"
  on public.course_reviews for select to authenticated
  using (
    hidden_at is null
    or member_id = (select auth.uid())
    or public.is_staff()
  );

create policy "members write their own course review"
  on public.course_reviews for insert to authenticated
  with check (member_id = (select auth.uid()) and hidden_at is null);

create policy "members edit their own course review"
  on public.course_reviews for update to authenticated
  using (member_id = (select auth.uid()))
  with check (member_id = (select auth.uid()));

create policy "members delete their own course review"
  on public.course_reviews for delete to authenticated
  using (member_id = (select auth.uid()));

-- Column privileges: what a member may write, and nothing else. Moderation
-- runs through the service role on the server, which these do not affect.
-- Note what this means for the client: an UPSERT names club_id and member_id
-- in its SET list and is refused, so the app inserts or updates explicitly.
revoke insert, update on public.course_reviews from anon, authenticated;
grant insert (club_id, member_id, rating, body, tags, played_month)
  on public.course_reviews to authenticated;
grant update (rating, body, tags, played_month)
  on public.course_reviews to authenticated;

-- ============ 3. The rating summary, on clubs ============
--
-- On `clubs` rather than in a view, for one reason: every list of courses in
-- the app and on the site already reads `clubs`, so the stars arrive with no
-- extra query, and `clubs` is readable by everyone — signed-out visitors to
-- a course page included — while the reviews themselves are not.
--
-- Recomputed from the source rows on every change rather than incremented.
-- An increment is faster and drifts the first time a trigger is skipped or a
-- row is fixed by hand; a club has tens of reviews, not millions, so the
-- honest version costs nothing.

alter table public.clubs
  add column if not exists rating_count integer not null default 0,
  add column if not exists rating_avg numeric(2, 1),
  -- [one-star count, two-star, ..., five-star]
  add column if not exists rating_dist integer[] not null default '{0,0,0,0,0}'::integer[];

create or replace function public.refresh_club_rating(p_club_id bigint)
returns void
language sql
security definer
set search_path = public
as $$
  update public.clubs c
  set rating_count = s.n,
      rating_avg = case when s.n > 0 then round(s.total::numeric / s.n, 1) end,
      rating_dist = s.dist
  from (
    select
      count(*)::int as n,
      coalesce(sum(rating), 0)::int as total,
      array[
        count(*) filter (where rating = 1)::int,
        count(*) filter (where rating = 2)::int,
        count(*) filter (where rating = 3)::int,
        count(*) filter (where rating = 4)::int,
        count(*) filter (where rating = 5)::int
      ] as dist
    from public.course_reviews
    where club_id = p_club_id and hidden_at is null
  ) s
  where c.id = p_club_id;
$$;

-- SECURITY DEFINER because members cannot update clubs — which is exactly
-- why nobody but the trigger may call it. See function-grants.test.ts.
revoke all on function public.refresh_club_rating(bigint) from public, anon, authenticated;

create or replace function public.course_reviews_after_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform public.refresh_club_rating(old.club_id);
  end if;
  if tg_op in ('INSERT', 'UPDATE') and (tg_op = 'INSERT' or new.club_id <> old.club_id) then
    perform public.refresh_club_rating(new.club_id);
  end if;

  -- Reviewing a course says you have played it. Written here so it cannot
  -- be forgotten by a client: a review with no matching "played" row would
  -- make "18 members have played here" undercount.
  if tg_op = 'INSERT' then
    insert into public.member_courses (member_id, club_id, kind)
    values (new.member_id, new.club_id, 'played')
    on conflict (member_id, club_id, kind) do nothing;
  end if;

  return null;
end;
$$;

revoke all on function public.course_reviews_after_change() from public, anon, authenticated;

drop trigger if exists course_reviews_rollup on public.course_reviews;
create trigger course_reviews_rollup
  after insert or update or delete on public.course_reviews
  for each row execute function public.course_reviews_after_change();

-- ============ 4. profiles ============
--
-- What the "Your game" step asks, plus the marker that the member has been
-- through the builder. Codes, not labels, so the wording can change without
-- a migration; the labels live in mobile/src/lib/onboarding.ts.
--
-- `onboarded_at` is set when the member finishes OR skips through the last
-- step. It answers "have we asked?", not "is the profile complete" — the
-- Finish-your-profile card on Home looks at the profile itself for that.

alter table public.profiles
  add column if not exists play_frequency text
    check (play_frequency is null or play_frequency in ('weekly', 'monthly', 'occasionally')),
  add column if not exists play_interests text[] not null default '{}'::text[]
    check (play_interests <@ array['casual', 'competitive', 'society', 'trips', 'marketplace', 'ladies']::text[]),
  add column if not exists onboarded_at timestamptz;

-- ============ 5. suggested_pinpals() ============
--
-- Members a signed-in member might want to connect with, best first:
--
--   same home club                      +1000
--   a home club within p_radius_km      up to +250, nearer scores higher
--   each course both have played or     +50
--   both have on a bucket list
--
-- Someone qualifies with any one of the three. Excluded: yourself, anyone
-- blocked in either direction, anyone you already have a connection row with
-- (pending, accepted or declined — a declined request is an answer), and
-- scrubbed accounts.
--
-- SECURITY INVOKER, deliberately. Everything it reads is readable by the
-- caller already — profiles, clubs, member_courses, and their OWN connection
-- rows — so it needs no privileges of its own and RLS stays the boundary.
-- That also means it cannot rank by mutual connections: another member's
-- connections are invisible to the caller, as they should be.
--
-- Distance is great-circle from club coordinates. 109 Irish clubs have none
-- (claude/app-courses-screen.md); members at those clubs are still found
-- through the same-club and shared-course routes, just never as "nearby".

create or replace function public.suggested_pinpals(
  p_limit integer default 20,
  p_radius_km numeric default 25
)
returns table (
  id uuid,
  first_name text,
  last_name text,
  avatar_url text,
  avatar_color text,
  home_club text,
  home_club_id bigint,
  handicap numeric,
  same_club boolean,
  distance_km numeric,
  shared_courses integer,
  score numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  with me as (
    select p.id, p.home_club_id, c.latitude as lat, c.longitude as lng
    from public.profiles p
    left join public.clubs c on c.id = p.home_club_id
    where p.id = (select auth.uid())
  ),
  my_courses as (
    select distinct club_id from public.member_courses where member_id = (select auth.uid())
  ),
  candidates as (
    select
      p.id, p.first_name, p.last_name, p.avatar_url, p.avatar_color,
      p.home_club, p.home_club_id,
      case when p.handicap_visible then p.handicap end as handicap,
      p.created_at,
      (me.home_club_id is not null and p.home_club_id = me.home_club_id) as same_club,
      case
        when me.lat is not null and c.latitude is not null then
          round((6371 * 2 * asin(sqrt(
            power(sin(radians(c.latitude - me.lat) / 2), 2)
            + cos(radians(me.lat)) * cos(radians(c.latitude))
              * power(sin(radians(c.longitude - me.lng) / 2), 2)
          )))::numeric, 1)
      end as distance_km,
      (
        select count(distinct mc.club_id)::int
        from public.member_courses mc
        where mc.member_id = p.id and mc.club_id in (select club_id from my_courses)
      ) as shared_courses
    from public.profiles p
    cross join me
    left join public.clubs c on c.id = p.home_club_id
    where p.id <> me.id
      and p.deleted_at is null
      and not public.is_blocked(me.id, p.id)
      and not exists (
        select 1 from public.connections x
        where (x.requester_id = me.id and x.recipient_id = p.id)
           or (x.recipient_id = me.id and x.requester_id = p.id)
      )
  )
  select
    id, first_name, last_name, avatar_url, avatar_color, home_club, home_club_id,
    handicap, same_club, distance_km, shared_courses,
    (case when same_club then 1000 else 0 end)
    + (case when not same_club and distance_km <= p_radius_km
         then round(250 * (1 - distance_km / greatest(p_radius_km, 1)), 1) else 0 end)
    + 50 * shared_courses as score
  from candidates
  where same_club
     or distance_km <= p_radius_km
     or shared_courses > 0
  order by score desc, created_at desc
  limit least(greatest(coalesce(p_limit, 20), 1), 100);
$$;

revoke all on function public.suggested_pinpals(integer, numeric) from public, anon;
grant execute on function public.suggested_pinpals(integer, numeric) to authenticated;

-- ============ 6. Reports can name a course review ============

alter table public.reports drop constraint if exists reports_target_type_check;
alter table public.reports add constraint reports_target_type_check
  check (target_type in (
    'user', 'listing', 'tee_time_invite', 'message', 'conversation', 'order', 'review',
    'post', 'post_comment', 'course_review'
  ));
