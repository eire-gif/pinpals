# Groups — architecture

Feed redesign, phase 11 (Oct 2026). **Status: model built, no tables yet.**

Groups like *Saturday Golf Crew*, *Dublin Golfers*, *Portmarnock members* and
*Algarve 2027*: standing communities with members, posts, events, polls, a
group chat and tee-time invitations.

## The principle: a group is an audience, not a new system

PinPals already has posts, tee times and group chats, each with its own
access rules, tests and screens. A group shouldn't get a second copy of any
of them. It gets **its members**, plus the ability to be the **audience** of
things that already exist:

| A group has… | Built on | What changes |
|---|---|---|
| Members | **new** `group_members` (owner / admin / member) | New table |
| Posts | `posts` (0088) | A third audience: `visibility = 'group'` + `posts.group_id`. Comments, reactions, mentions, saves and share links (phases 4–6) come for free |
| Tee-time invitations | `tee_time_invites` (0065) | A third visibility: `'group'` + `group_id`. Interest, confirm, drop-out, recaps and shared rounds (phases 7, 9) come for free |
| Group chat | `conversations` kind `'group'` (0087) | `groups.conversation_id`. Members are kept in step with `conversation_members`, still the single source of truth for who's in a conversation. Only for groups of 20 or fewer (0087's cap) |
| Events | **new** `group_events` + RSVPs | A dated plan ("Captain's Day, 14 Nov, Lahinch"). Can spawn tee times with `visibility = 'group'` |
| Polls | **new** `group_polls` / options / votes | Small, self-contained |

### Phase 11 deliverable: the shared model

`src/lib/groups.ts`, byte-identical in `mobile/src/lib/` (drift test; 12
tests in `groups.test.ts`). Pure, no imports, nothing reads it yet:

- **Kinds:** `crew` (invite-only, ≤20, chat on), `area` (open, county-anchored, no chat), `club` (request-to-join, club-anchored, no chat) and `trip` (invite-only, ≤20, dated, chat on). Each has a label, example, icon, default privacy, default features and max size.
- **Privacy:** `open` (one tap to join) · `request` (an admin approves) · `invite` (hidden from anyone not invited).
- **Roles:** owner ⊃ admin ⊃ member. `groupCan(role, action, settings)` is the permission matrix for 15 actions. Non-members can only view an open group's front page, never its posts, chat or tee times. A switched-off feature is off for everyone, owner included. Two settings, `membersCanPost` and `membersCanInvite`, let a club group work as announcements only.
- **Getting in:** `joinState()` returns member / join / request / requested / invited / hidden / closed. A block between the viewer and the owner or an admin closes the door.
- **Names:** `groupNameProblem()` (same shape as 0087 titles; can't start with "PinPals") and `groupSlug()`.

## ⚠️ The trap in the existing audience checks

Every audience check today is written as "**members, or connected**":

```sql
-- posts select policy and can_view_post(), 0088
visibility = 'members' or public.are_connected(author_id, auth.uid())
-- invite_is_visible_row(), 0065/0066
target_visibility = 'everyone' or ... or public.are_connected(auth.uid(), target_member_id)
```

That's correct while there are exactly two values. **Adding `'group'`
without rewriting them would show every group post and group tee time to
all of the author's connections.** Each check must become explicit:

```sql
visibility = 'members'
or (visibility = 'connections' and public.are_connected(author_id, auth.uid()))
or (visibility = 'group' and public.is_group_member(group_id, auth.uid()))
```

There are three places: the inline posts SELECT policy (0088, inline for
the planner), `can_view_post()` (0088; also gates photo storage, comments,
likes, saves) and `invite_is_visible_row()` plus the interest policy that
calls it (0065/0066). RLS tests must assert that a connection who isn't in
the group sees nothing: post, photo, comment, like count, tee time, or the
tee time's interest rows.

## Draft schema (not in `supabase/migrations/`)

```sql
create table public.groups (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('crew', 'area', 'club', 'trip')),
  name text not null check (char_length(trim(name)) between 1 and 60),
  slug text not null unique,
  about text check (char_length(about) <= 500),
  privacy text not null check (privacy in ('open', 'request', 'invite')),
  features text[] not null,            -- subset of posts/events/polls/chat/tee_times
  members_can_post boolean not null default true,
  members_can_invite boolean not null default true,
  -- Anchors: one or none, by kind.
  county text,                          -- area
  club_id bigint references public.clubs (id) on delete set null,   -- club
  starts_on date, ends_on date,         -- trip
  cover_path text,                      -- post-images bucket, same staging + EXIF strip
  conversation_id bigint unique references public.conversations (id) on delete set null,
  member_count integer not null default 0,   -- kept by trigger, like like_count
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  hidden_at timestamptz                 -- moderation
);

create table public.group_members (
  group_id bigint not null references public.groups (id) on delete cascade,
  member_id uuid not null references public.profiles (id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'admin', 'member')),
  joined_at timestamptz not null default now(),
  muted boolean not null default false, -- notifications only
  primary key (group_id, member_id)
);
create unique index group_one_owner on public.group_members (group_id) where role = 'owner';

-- Invitations and join requests in one table: same shape, opposite direction.
create table public.group_invitations (
  id bigint generated always as identity primary key,
  group_id bigint not null references public.groups (id) on delete cascade,
  member_id uuid not null references public.profiles (id) on delete cascade,
  direction text not null check (direction in ('invite', 'request')),
  invited_by uuid references public.profiles (id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  unique (group_id, member_id)
);

alter table public.posts add column group_id bigint references public.groups (id) on delete cascade;
-- visibility check becomes ('members', 'connections', 'group') with
-- check ((visibility = 'group') = (group_id is not null))
alter table public.tee_time_invites add column group_id bigint references public.groups (id) on delete cascade;
-- same pairing on ('everyone', 'connections', 'group')

create table public.group_events (
  id bigint generated always as identity primary key,
  group_id bigint not null references public.groups (id) on delete cascade,
  title text not null check (char_length(trim(title)) between 1 and 80),
  starts_at timestamptz not null,
  club_id bigint references public.clubs (id) on delete set null,
  details text check (char_length(details) <= 1000),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create table public.group_event_rsvps (
  event_id bigint not null references public.group_events (id) on delete cascade,
  member_id uuid not null references public.profiles (id) on delete cascade,
  answer text not null check (answer in ('going', 'maybe', 'no')),
  primary key (event_id, member_id)
);
alter table public.tee_time_invites add column group_event_id bigint references public.group_events (id) on delete set null;

create table public.group_polls (
  id bigint generated always as identity primary key,
  group_id bigint not null references public.groups (id) on delete cascade,
  question text not null check (char_length(trim(question)) between 1 and 140),
  multiple boolean not null default false,
  closes_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create table public.group_poll_options (
  id bigint generated always as identity primary key,
  poll_id bigint not null references public.group_polls (id) on delete cascade,
  label text not null check (char_length(trim(label)) between 1 and 60),
  position smallint not null, unique (poll_id, position)
);
create table public.group_poll_votes (
  option_id bigint not null references public.group_poll_options (id) on delete cascade,
  poll_id bigint not null references public.group_polls (id) on delete cascade,
  member_id uuid not null references public.profiles (id) on delete cascade,
  primary key (option_id, member_id)
  -- single-choice polls: unique (poll_id, member_id) enforced by trigger when not multiple
);
```

### Access, in one place

- `is_group_member(group_id, uid)` and `group_role(group_id, uid)`: security
  definer, `coalesce(…, false)` (the 0066 lesson), `auth.uid()` read inside
  wherever possible.
- `groups`: an open or request group's front page (name, about, kind,
  member count) is readable by signed-in members. An invite group is
  readable only by its members and invitees.
- Everything inside a group (`group_members` lists, events, RSVPs, polls,
  votes, group posts, group tee times) is readable only by members.
- Writes go through SECURITY DEFINER functions (`create_group`, `join_group`,
  `respond_group_invitation`, `leave_group`, `set_group_role`), the 0087
  `create_group_conversation` pattern, checking `groupCan()`'s rules in SQL.
- **Blocks.** Group chat keeps 0087's rule: blocking anyone in the thread
  stops you posting. In group posts, the existing author↔viewer block in
  `can_view_post` already hides each from the other. A block with the owner
  or an admin closes the door to joining (`joinState`). Two ordinary
  members who have blocked each other can both be in an open group; each
  simply doesn't see the other's posts.
- **Group chat sync.** Joining or leaving a group with chat calls the same
  internal step `add_conversation_member` uses, so `conversation_members`
  stays the one answer. Chat can only be on while `member_count ≤ 20`.

### Everything else it touches

- **Account deletion** (`account-deletion.ts`, 0080): `group_members`
  cascades. An owner's deletion hands the group to the longest-serving
  admin, else the longest-serving member, else deletes it. Cover photos are
  removed with the member's other `post-images` files.
- **Reports and moderation:** `reports.target_type` gains `'group'`, and
  staff can set `groups.hidden_at`. Area and club groups are the ones that
  need it.
- **Notifications:** `group_invited`, `group_request`, `group_joined`
  (to admins), `group_event`, `group_poll`, `group_tee_time`. All go
  through the existing `notifications` + push seam, with a per-group
  `muted` flag. Group posts don't notify everyone.
- **Feed:** a group post shows in For You for its members, labelled with the
  group, and in the group's own feed; never in Following for non-members.
  `loadFeed` needs no new scope; RLS already filters.

## Rollout, each step safe on its own

| Step | What | Risk | Undo |
|---|---|---|---|
| **A** ✅ | Model + tests (this phase) | None | Delete the file |
| **B** | `groups`, `group_members`, `group_invitations`, membership functions, RLS. **No audience changes.** App: Groups screen, create a crew/trip, invite connections, members list, and chat via `create_group_conversation` | Low: new tables only | Drop them |
| **C** | **Group posts.** Rewrite the three audience checks explicitly (above), add `posts.group_id`, a composer audience picker and a group feed. RLS tests for a connection outside the group, photos, comments and likes | **High: the privacy core.** Its own PR and review | Revert the policy and function bodies; group posts become author-only |
| **D** | **Group tee times.** Same rewrite in `invite_is_visible_row` and the interest policy; notify group members | Medium | As C |
| **E** | Events (+RSVP; "make tee times for this") and polls | Low | Drop the tables |
| **F** | Area and club groups: discovery, request queues, reports, staff moderation | Medium (moderation load) | Hide via `hidden_at` |

## Decisions needed before B

1. **Who creates Local and Club groups.** Recommended: PinPals seeds one per
   county and one per club (from `clubs`), and members create crews and
   trips. Otherwise you get five "Dublin Golfers" groups.
2. **Club membership proof.** Anyone can set a home club today. Recommended:
   club groups are request-to-join with a club admin approving; the GUI
   membership number members can already enter could support it later.
3. **Leaving a group.** Recommended: your posts stay visible to the group
   (like leaving a group chat) unless you delete them.
4. **Group chat above 20 people.** Recommended: not offered. Big groups use
   posts and events. Lifting 0087's cap is its own decision about moderation.
