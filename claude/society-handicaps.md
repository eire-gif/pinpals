# Society officers, handicaps and Find PinPals (Oct 2026, migration 0122)

A society is run by whoever started it, who appoints a captain and a secretary. Members get a handicap indicator from their scorecards, and the secretary gets one screen to set the handicaps the society plays off.

## Decisions (Eire, 12 Oct 2026)
- **The creator controls a society** and appoints a **captain** and a **secretary** — one of each.
- **Only the owner, captain and secretary bring people in**: invite, share or reset the link, approve requests. Members of a society never invite.
- **Handicap indicator**: worked out from the last 20 scorecards, shown on the member's profile. It **never overwrites** the handicap the member set at sign-up.
- **Society handicaps** worked out for the course being played, to make the handicap secretary's job easy.
- **Find PinPals** wherever people are invited to a group.
- **Back button** on "From a group".

## What a member sees
- **Profile → Handicap indicator** (under the cover card): the indicator, "Best 8 of your last 20 scorecards", and how it compares with their own handicap. Tap for the cards behind it, with the ones that count highlighted; each opens the scorecard.
- **A society's page:**
  - Badges read Owner, Captain, Secretary or "Owner · Secretary".
  - The owner taps a member: **Make captain / Make secretary / Stand down**. Appointing a new captain stands the old one down (with a confirm). The owner can take an office themselves by tapping their own name.
  - Officers see **Invite** and **Find PinPals**, plus **Handicaps**. Members see "The captain or secretary brings new members in".
  - A line tells members that the owner, captain and secretary can see their handicap and indicator.
- **Handicaps screen** (owner, captain, secretary):
  - One row per member: own handicap, PinPals indicator (and how many cards), and what the society plays them off ("SOCIETY" once set, otherwise "OWN").
  - Tap a row to set the society figure: type it, or **Use indicator** / **Use own**, or **Clear**.
  - **Show course handicaps for a course**: pick the course and tees and every row adds its course handicap and 95% playing handicap.
- **Society rounds** (From a group) pre-fill each member with the society's figure, else their own shared index.
- **Invite screen**, for whoever runs the group: tabs **Your PinPals** / **Find PinPals**. Find searches every member by name or club. The group page's Find PinPals button opens that tab. Ordinary crew members' Find PinPals goes to the members directory, to connect first.
- **From a group** has a Back button, and the summary reads "1 tee group of 4 players · 95% handicap allowance" (was "1 group: 1 · …").

## The indicator (WHS)
| Step | Rule |
|---|---|
| Eligible card | 18 holes, course rating and slope on the card, 14+ holes scored. 9-hole cards don't count yet |
| Per hole | Capped at net double bogey: par + 2 + strokes received (course handicap from the index on the card, else the member's own). No index at all: par + 5. A hole with no score counts as net double bogey |
| Differential | 113 / slope × (adjusted gross − course rating), to 0.1. No playing-conditions adjustment |
| Indicator | Best N of the last 20 (3 → best 1 −2.0, 4 → best 1 −1.0, 5 → 1, 6 → best 2 −1.0, 7–8 → 2 … 20 → 8), to 0.1, max 54.0. Fewer than 3 cards: none |

Not included: soft/hard caps against a low handicap index, exceptional-score reductions, PCC. It's a guide, labelled as one.

## Database (0122_society_officers_and_handicaps.sql)
- `group_members.office` ('captain' | 'secretary'), one of each per group; `society_index`, `society_index_set_by`, `society_index_set_at`.
- `groups_society_invites_check`: a society's `members_can_invite` is always false. `create_group` and `update_group` recreated to keep it so.
- `set_group_office(group, member, office|null)` — owner only, societies only. An officer is role 'admin'. `set_group_role` refuses a plain 'admin' in a society, and making someone a member clears their office.
- `invite_to_group` — owner/admins can invite **any** member (blocks, deleted accounts and admin blocks still skipped; the invitee still accepts). Ordinary members still invite connections only.
- `handicap_differentials_of(member)`, `handicap_indicator_of(member)` — internal, no grants.
- `my_handicap_indicator()`, `my_handicap_differentials()` — your own only.
- `society_handicaps(group)`, `set_society_handicap(group, member, index|null)` — owner and officers only. These read members' private scorecards to compute the indicator: that's the deliberate trade, and the society page says so.

## Map
- Shared model: `GROUP_OFFICES`, `roleLabel()` in `src/lib/groups.ts` ↔ `mobile/src/lib/groups.ts` (+ tests).
- Indicator explanation: `mobile/src/lib/handicap-indicator.ts` (+ test); reads in `lib/scorecards.ts`.
- Group data: `lib/groups-data.ts` (`setMemberOffice`, `loadSocietyHandicaps`, `setSocietyHandicap`, roster uses `society_index`).
- Screens: `app/handicap-indicator.tsx`, `app/group/[id]/handicaps.tsx`; edits to the group page, invite, settings, profile, `live/_layout.tsx`, `live/day/group.tsx`.

## Verified
- Full replay of 122 migrations.
- RLS 707/707: 8 new in `society-handicaps.test.ts` (indicator maths, exclusions, offices, invites, officer-only handicaps). Making `society_handicaps` open to any member fails a test, which was checked. Existing group tests updated to appoint officers where they made society admins.
- Function grants register updated.
- Website: tsc clean, 1264 unit tests (new: offices, indicator table).
- App: tsc clean.

## To ship
1. Apply `0122_society_officers_and_handicaps.sql` to production.
2. Merge; Vercel deploys (no website changes beyond the shared model).
3. `git pull origin main`, then `cd mobile && eas update --branch production --platform ios`. No native build.

## Not done / later
- Not run on a phone yet.
- Existing societies with a plain admin keep them until the owner reassigns (pre-launch, so likely none).
- 9-hole scores, caps and PCC in the indicator.
- Showing the indicator on other members' profiles (only the member and society officers see it today).

## Cover photo and logo (12 Oct 2026, migration 0124)
- **Decision (Eire):** only a society's captain or secretary changes them; the owner too, as they appoint both. In a crew or trip, whoever runs it.
- **On the group page:** with a cover, the photograph runs edge to edge across the top with the logo half over it; "Cover" (top right) changes it. Without one, those who can see "Add a cover photo". Tapping the logo (camera badge) changes it, cropped square on the phone. Both can be removed.
- **The logo replaces the kind's icon everywhere:** the group page, My groups, Find a society, Home's strip and the draw screen. (Not yet on the invite-link page.)
- **How:** `POST /api/app/groups/[id]/image` (`which` = cover | logo, `image` or `remove=on`) re-encodes with sharp (no EXIF/GPS; cover 1600 px, logo 512 px) into the uploader's own `member-avatars` folder as `group-<id>-<which>-<ts>`, then calls `set_group_image()` as them.
- **Database:** `groups.cover_url`, `groups.logo_url` (column-granted: never `select *` from groups); `group_can_style()` (internal), `set_group_image()` — checks the role and that the URL is in the caller's own folder under a `group-` name.
- **Verified:** RLS 711/711 (3 new in `group-images.test.ts`); site tsc and 1266 unit tests; app tsc. **0124 already applied to production.**
- **To ship:** merge (Vercel deploys the upload route), then `eas update`. #188 (0123) must merge first or with it — this branch includes it.
