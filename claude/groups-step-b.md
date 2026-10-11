# Groups, step B (Oct 2026, migration 0120)

Crews, trips and societies: creating a group, getting people in, and running it. Design and later steps: `claude/groups-architecture.md`.

## Decisions (Eire, 11 Oct 2026)
- Members can start **crews, trips and societies**. Local (county) and club groups wait for staff moderation and seeding (step F); `create_group()` refuses them.
- **Societies** are a new fifth kind: searchable, golfers **ask to join**, the owner (secretary) and admins (committee) approve. No group chat (most are 30–60 golfers; 0087 chats hold 20). Up to 500 members.
- An **invite link** (`pinpals.ie/join/g/<code>`) joins anyone straight in, with no queue: the secretary sharing it is the approval. The AASA already claims `/join/*`.

## What a member does
- **☰ → Members → Groups**, or Home's strip (only shown with an invitation waiting or groups to list).
- **Start a group:** kind, name, about; a society can add its home club.
- **Group page:**
  - Members can tap Invite and Chat (crews and trips, once three are in).
  - Owners and admins also get Settings.
  - Members, with Owner/Admin badges.
  - Owners and admins see join requests to Approve/Decline.
  - Tapping a member gives the owner Make admin / Hand over / Remove.
  - Mute, and Leave.
  - Posts, Tee times and Events show as "Soon" (steps C–E).
- **Invite:** share the link (WhatsApp, Text, More), or tick connections to send invitations. Admins can reset the link.
- **Find a society:** every society by name, then Ask to join.
- **Not a member:** the front page only, with Join / Decline (invited), Ask to join (society), or "Request sent · Withdraw".

## Database (0120_groups.sql)
| Table | Holds |
|---|---|
| `groups` | kind, name, about, privacy, features, members_can_invite, club_id, trip dates, conversation_id, invite_code, member_count, hidden_at |
| `group_members` | group, member, role (owner/admin/member), muted; one owner per group |
| `group_invitations` | one row per person per group: direction invite/request, status pending/accepted/declined |

- **Reads (RLS):**
  - A society's (or open group's) front page: any signed-in member.
  - An invite-only group: its members and pending invitees only.
  - The member list: members only.
  - Invitations: the person, the inviter, and owner/admins.
  - Hidden groups: nobody.
  - `invite_code` is withheld by a column grant, so **never `select("*")` from `groups`**.
- **Writes:** only through functions. Members have SELECT and nothing else.
  - `create_group`, `update_group`, `delete_group`
  - `invite_to_group` (connections only; skips anyone it can't invite), `respond_group_invitation`
  - `request_to_join_group` (a declined request can be repeated after 7 days), `withdraw_group_request`, `review_group_request`
  - `group_invite_code`, `reset_group_invite_code`, `group_invite_preview` (anon too, for the website), `join_group_by_code`
  - `leave_group` (the owner must hand over first; alone, leaving deletes), `remove_group_member` (owner: anyone; admin: members only), `set_group_role` (owner; 'owner' hands over), `set_group_muted`
- **Every way in** goes through `group_add_member()`: not hidden, not blocked by the owner or an admin, room left.
- **Trigger** `group_members_after_change`:
  - Keeps `member_count`.
  - Passes an owner's group to the longest-serving admin, else member, and deletes an empty group.
  - Syncs a crew's or trip's chat (`group_sync_chat`): starts at 3 members, adds in join order, leaves out anyone with a block against someone already in it, and removes leavers.
- **Account deletion** (`account-deletion.ts`) deletes the member's group rows, which runs the trigger.
- **Not touched:** posts, tee times, live rounds. Group audiences are steps C and D.

## Notifications
- `POST /api/app/groups/[id]/notify { event: invited | requested | approved, memberId? }` is called fire-and-forget by the app after the change.
- Recipients come from the invitation rows; each event is checked against the caller under their own client.
- Types `group_invited`, `group_join_request` (owner and admins who haven't muted), `group_request_approved`, in the **feed** category. Deduped per invitation and moment.
- Hrefs: `/groups/<id>` opens `/group/<id>` in the app; the website shows an open-in-app page.

## Website
- `/join/g/<code>`: the group's front page.
  - Signed in: Join.
  - Signed out: the code goes in the `pp_group_invite` cookie, and middleware joins on the first signed-in request.
- The app does the same with SecureStore (`consumePendingGroupInvite` in `_layout.tsx`).

## Map
- **Shared model:** `src/lib/groups.ts` ↔ `mobile/src/lib/groups.ts`. Adds `society`, `CREATABLE_GROUP_KINDS` and the invite-link helpers.
- **App data:** `mobile/src/lib/groups-data.ts`
- **Screens:** `app/groups/index.tsx`, `groups/new.tsx`, `groups/find.tsx`, `group/[id]/index.tsx`, `group/[id]/invite.tsx`, `group/[id]/settings.tsx`, `join-group.tsx`
- **Components:** `components/group-bits.tsx`, `components/home-groups.tsx`
- **Flag:** `groups` is now a kill switch, on.

## Verified
- Full replay of 120 migrations.
- RLS 691/691, 24 of them new in `groups.test.ts`. Loosening the group or member-list policy fails three of them, which was checked.
- Function grants register updated.
- Website: tsc clean, 1242 unit tests.
- App: tsc clean, 222 lib tests.

## To ship (order matters)
1. Apply `0120_groups.sql` to production.
2. Merge, and let Vercel deploy (the notify route and `/join/g`).
3. `git pull origin main` in the Codespace, then `eas update`. No native build is needed.

The flag is on in this branch, so an OTA before step 1 would show screens that error. If that happens, set `groups: false` and publish again.

## Known limits
- Someone who leaves a crew's chat but stays in the group is added back to the chat the next time anyone joins or leaves the group.
- Trip dates aren't on the create screen yet; the database takes them.
