# Shared rounds — data model and the backend changes it needs

Feed redesign, phase 9 (Oct 2026). **Status: model built, backend not migrated.**

A shared round is one played round that several PinPals were part of: the
course, the date, who played, each player's score, photos any of them took,
one conversation, and later shot maps. Each player should be able to add to
it without making another copy of the round.

## What was built in phase 9 (no migration)

`src/lib/shared-round.ts`, byte-identical in `mobile/src/lib/` (a drift test
in `shared-round.test.ts` fails if they differ). It's pure, with no imports:

| Function | What it does |
|---|---|
| `buildSharedRound({ teeTime, players, posts })` | One `SharedRound` from a tee time, its players and whatever posts the reader can see |
| `sharedRoundKey(kind, details)` | `"tee:<id>"` for a round post tagged with a tee time, else null |
| `duplicateRoundPosts(posts)` | In a page of feed posts, maps each later post of a round to the first: what a feed that folds duplicates would hide |
| `visibleParticipants(round, viewerId)` | The privacy rule: players see the whole fourball, everyone else sees only players who shared a score or photo |
| `scoreLine(round)` | "Ciarán 78 (+6) · Aoife 84 (+12)" |

`SharedRound` = `{ key, teeTimeId, course, date, participants[{ memberId, name, role, score }], media[{ path, contributorId, postId, width, height }], threadPostId, postIds, shotMaps[] }`.

The shape is the one the tables below will fill, so screens built on it
won't change when the backend arrives. Nothing on screen uses it yet.

### Where each part comes from today

| Part | Source today | Gap |
|---|---|---|
| The round | `tee_time_invites` row whose day has passed (0084's sweep sets `completed`) | Rounds not arranged through PinPals can't be shared |
| Participants | Host + `tee_time_interests` where `status = 'confirmed'`, readable to the fourball via 0078 | None |
| Each player's score | That player's round post with `details.tee_time_id` (0099; `createPost` checks they hosted or confirmed) | A player must make a full post to add a score |
| Shared media | Photos on those posts (`post_images`) | **A player can't add a photo without making their own post.** That post is the duplicate copy we want to avoid |
| Comments | The first post's thread | **Each player's post has its own thread.** If the first post is deleted, the round loses its conversation |
| Shot maps | Nothing | No shot capture or hole geometry anywhere |

## Why this isn't migrated now

The new tables on their own are low-risk. Everything that makes them useful
touches parts of PinPals that have caused incidents before, or needs a product
decision first:

1. **Photo storage read policy.** `post-images` is readable only through
   `can_view_post(post_image_post_id(name))` (0088). Round photos need a second
   policy on the same bucket. Policies OR together, so it's additive, but it
   is the access check on members' photos (see `incident-avatar-exif-gps`).
   It needs its own review and RLS tests.
2. **Whose audience applies.** Aoife adds a photo to a round Ciarán posted
   to "members". Is it shown to every member, or only to Aoife's audience?
   This is a product decision, and it decides the schema (see Decisions).
3. **Account deletion.** `account-deletion.ts` removes a member's
   `post-images` files. Round photos and scores must be purged too (GDPR
   Art. 17, Guideline 5.1.1(v)). That's a legal obligation, not a nice-to-have.
4. **Feed semantics.** Folding three posts into one card changes counts,
   notifications and "My posts". That needs on-device testing.

## Target model

### Tables (new; draft, not in `supabase/migrations/`)

```sql
-- One played round. Created lazily on the first contribution, not for
-- every tee time. tee_time_id is unique: one round per tee time, which is
-- the "no duplicate copies" guarantee.
create table public.rounds (
  id bigint generated always as identity primary key,
  tee_time_id bigint unique references public.tee_time_invites (id) on delete set null,
  club_id bigint references public.clubs (id) on delete set null,
  played_on date not null,
  -- The post whose comments are the round's conversation (phase 5 reused
  -- whole: comments, mentions, likes, reactions, share links).
  thread_post_id bigint unique references public.posts (id) on delete set null,
  created_at timestamptz not null default now()
);

-- Who played. Seeded from host + confirmed interests when the round is
-- created; later confirmations/drop-outs follow the tee time.
create table public.round_players (
  round_id bigint not null references public.rounds (id) on delete cascade,
  member_id uuid not null references public.profiles (id) on delete cascade,
  role text not null check (role in ('host', 'player')),
  -- Their numbers, same shape and same validation as a round post's details:
  -- check (details is null or public.post_details_valid('round', details)).
  details jsonb,
  shared_at timestamptz,          -- null = played, hasn't shared anything
  primary key (round_id, member_id)
);

-- Photos added to the round. One row per photo however many people see
-- it. Stored at post-images/rounds/<round_id>/<contributor>/<uuid>.jpg
-- after the same staging + EXIF strip as post photos.
create table public.round_media (
  id bigint generated always as identity primary key,
  round_id bigint not null references public.rounds (id) on delete cascade,
  contributor_id uuid not null references public.profiles (id) on delete cascade,
  path text not null unique check (char_length(path) <= 300),
  width integer check (width > 0),
  height integer check (height > 0),
  created_at timestamptz not null default now(),
  hidden_at timestamptz             -- moderation, like posts.hidden_at
);
create index round_media_round_idx on public.round_media (round_id, created_at);

-- A post that is a contribution to a round, so the feed shows the round once.
alter table public.posts add column round_id bigint references public.rounds (id) on delete set null;

-- Later, once something captures shots (GPS needs a native build) and
-- clubs have hole geometry (a course_holes table):
-- create table public.round_shots (round_id, member_id, hole, shot_number,
--   lat, lng, club, lie, result, primary key (round_id, member_id, hole, shot_number));
```

### Access rules

- `can_view_round(round_id)`, security definer, reads `auth.uid()` inside (the
  `can_view_post` pattern): true for a `round_players` member, or when
  `can_view_post(thread_post_id)` is true.
- `round_players`: select if `can_view_round`, **but** outside the fourball
  only rows with `shared_at is not null` (the `visibleParticipants` rule,
  enforced in the database). Update: your own row's `details` only.
- `round_media`: select if `can_view_round` and not hidden, and the viewer and
  contributor haven't blocked each other. Insert only through the API
  (service role, after the participant check). Delete your own.
- Storage: one new select policy on `post-images` for names under `rounds/`
  → `can_view_round(round_media_round_id(name))`. No change to the existing
  post-photo policy.
- Writes go through `/api/app/rounds/*`, so participation is checked in one
  place (the same host-or-confirmed check `createPost` does for 0099).

## Rollout, each step safe on its own

| Step | What | Risk | Undo |
|---|---|---|---|
| **A** ✅ | Model + tests (this phase) | None, nothing reads it yet | Delete the file |
| **B** | Migration: the three tables, `posts.round_id`, `can_view_round`, RLS. Additive, so nothing existing changes. Backfill `rounds` + `round_players` from round posts that carry `tee_time_id`; set `thread_post_id` to the earliest post; **existing posts are not merged or deleted** | Low | Drop the tables and the column |
| **C** | API: `GET /api/app/rounds/[id]` (returns a `SharedRound`), `POST …/scores`. `createPost` with a `tee_time_id` attaches to the existing round instead of starting a new one | Low | Revert the routes |
| **D** | Round photos: staging, storage policy, `round_media` writes, account deletion purges `round_media` + files + `round_players` | **Privacy.** Review + RLS tests before merging | Drop the policy; files stay private |
| **E** | App: recap composer says "Add to Ciarán's round" when a partner already shared, adding a score/photos without a new post; feed draws one shared-round card (`duplicateRoundPosts` until `posts.round_id` is everywhere); notify the thread's author when someone adds to it | Medium (UX) | OTA rollback |
| **F** | Shot maps: `course_holes` geometry + capture (native, TestFlight) + `round_shots` | Needs a native build | n/a |

## Decisions needed before B

1. **Audience of contributions.** Recommended: a contribution is shown to
   whoever can see the round's thread post, and the composer says so ("Shown
   to everyone who can see Ciarán's round"). The alternative, each photo
   keeping its contributor's audience, needs a per-media visibility check.
2. **When the thread post is deleted.** Recommended: promote the next
   contributor's post to be the thread; if none, the round stays but has no
   conversation until someone shares. The alternative, comments owned by the
   round (`post_comments.round_id`), changes `post_comments` RLS. Defer it.
3. **Rounds outside PinPals tee times** (a member logs a round with friends
   who are members). Needs invitations to a round, which is a separate feature.
