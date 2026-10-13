# The admin console (/admin)

October 2026. How the console is laid out, and the controls every list and
detail page shares. Background: `admin-architecture-review.md` (roles,
`requireStaff()`, `is_staff()`), `feed-code-quality-rules.md`.

## Layout

- **Own chrome.** The public site header and footer are left off `/admin/**`
  (`src/components/site-chrome-gate.tsx`, a path check in the root layout that
  leaves the `pp_shell` app-web-view logic alone). The admin bar has a
  **View site** link, the signed-in email, the role badge and Sign out.
- **Grouped sidebar** (`src/lib/admin/nav.ts`, tested in `nav.test.ts`):
  Overview · Community (Users, Groups & societies, Tee times, Social, Support
  cases) · Marketplace (Marketplace, Listings, Orders, Reviews) · Money (Seller
  accounts, Payout ledger, Webhook events — finance roles) · Advertising ·
  Content (Courses, Course reviews, News review, News sources) · Safety
  (Reports, Risk flags) · Platform (Staff, Audit log — super admin). Items a
  role can't open are hidden; the page's own `requireStaff()` is still the
  boundary. The current page is highlighted (longest matching link). On a
  phone the sidebar folds into a **Menu** button above the page.
- **Overview** (`src/app/admin/page.tsx`): *Needs attention* — open reports,
  open support cases, problem sales, orders awaiting payment, webhook failures
  in the last 7 days, sellers with Stripe onboarding incomplete (those four are
  finance roles only), listings to review, hidden listings, hidden posts,
  suspended members, live ad campaigns. Each card links to its page; a
  non-zero "alert" card turns navy. Then a *Community snapshot*. Counts come
  from `getOverviewMetrics()` (queries.ts) and `getAdminAttention()` /
  `getCommunitySnapshot()` (`src/lib/admin/admin-lists.ts`); a count that
  can't be taken shows "—" rather than breaking the page.
- **Page headers** use `AdminPageHeader` (`src/components/admin/page-header.tsx`):
  Playfair title, one short line, primary action on the right. Section tabs
  (Marketplace, Advertising, Groups) are pill rows that wrap — no horizontal
  scrollbar.
- **Tables** share one look: rounded card that scrolls sideways on a phone,
  uppercase column heads, `Pill` status pills, one empty state
  (`src/components/admin/table.tsx`).

## The shared controls

Every list row has a **⋯ menu** and a **checkbox**; ticking rows brings up a
sticky **bulk bar**. Every detail page has an **Actions** panel with the same
items as buttons and, where the record has a generic edit, an **Edit** form at
`#edit`. One set of components, not per-page copies:

| Piece | File |
|---|---|
| Rules (roles, verbs, edit fields, delete guards) — pure, tested | `src/lib/admin/controls.ts`, `controls.test.ts` |
| Server Actions: `runControl`, `saveRecordEdit`, `cancelMemberDeletion` | `src/app/admin/controls/actions.ts` |
| ⋯ menu / action buttons | `src/components/admin/controls/row-actions.tsx` (`AdminRowActions`) |
| Confirmation (reason, typed name for deletes) | `confirm-dialog.tsx` (`ConfirmDialog`) |
| Checkboxes and bulk bar | `bulk.tsx` (`BulkProvider`, `SelectRow`, `SelectAll`, `BulkBar`) |
| Detail-page panel + edit form | `record-panel.tsx`, `edit-record-form.tsx` |
| Toasts | `toaster.tsx` (`adminToast()`, `<AdminToaster />` in the layout) |

The verbs:

- **Edit** — the meaningful fields only, validated server-side against the
  same limits as the database. The audit row carries a before/after for each
  changed field.
- **Hide / Restore** — the everyday, reversible takedown.
- **Remove / Add back** — only where the domain has its own "removed" state:
  a listing force-removed from any status (Add back returns it to the status
  it had, read from the audit log), an event cancelled / re-opened.
- **Delete permanently** — super admin only, reason required, type the item's
  name to confirm ("delete N" for a bulk delete). The audit row carries a
  snapshot of the deleted row.

Wherever an action already existed it is called unchanged (its checks,
notifications and audit row stay as they were): suspend/reinstate,
hide/restore/force-remove listing, cancel/restore tee time, hide/restore post,
comment, course review and review, suspend/reinstate shop.

### Who can do what

| | Edit | Hide / Restore | Remove / Add back | Delete permanently |
|---|---|---|---|---|
| Users | super admin (existing member form) | Suspend / Reinstate — moderator+ | — | super admin: starts account deletion |
| Listings | admin+ (title, description) | moderator+ (live listings) | Remove: super admin · Restore/Add back: moderator+ | super admin, refused if any order, offer, auction or paid promotion |
| Tee times | admin+ (notes) | Cancel / Add back — moderator+ | — | super admin |
| Courses | admin+ (existing course form) · **Add course** | admin+ | — | super admin, refused while anything uses the course |
| Groups (crews, trips, societies) | admin+ (name, about) | moderator+ | — | super admin, refused if events have payment records or results |
| Group events | admin+ (title, details) | moderator+ | Cancel / Re-open — moderator+ | super admin, refused if payment records |
| Social posts & comments | admin+ (text) | moderator+ | — | super admin (post photos/videos removed from Storage) |
| Course reviews | admin+ (rating, text) | moderator+ | — | super admin |
| Marketplace reviews | admin+ (rating, text) | moderator+ | — | super admin |
| Pro shops | admin+ (name, description) | Suspend / Reinstate — finance roles | — | super admin, refused if orders or listings |
| News articles | existing review page (any staff) | Reject / Retract on the review page | — | super admin, drafts and rejected only |

Support is read-only everywhere. "moderator+" = moderator, admin, super admin.
"admin+" = admin, super admin. Course edits moved from any staff to admin+ in
this change, per the role model.

### Delete rules

- **Members are never hard-deleted here.** Delete starts the existing account
  deletion (`requestAccountDeletionByStaff()` in `src/lib/account-deletion.ts`):
  same request row, same lock (ban + sign-out), same stand-down of hosted tee
  times, listings and posts, same scheduled scrub that deletes or anonymises.
  Blocked by the same rules as a member's own request
  (`can_delete_account_for()`, 0140 — open orders, payouts, refunds,
  disputes), and refused for staff accounts and yourself. Default is the
  30-day grace; ticking "run at the next scheduled run" schedules it a minute
  out. **Cancel deletion** on the member's page undoes it while it's pending.
  Places the member holds on other people's tee times are released by the
  scrub, not at request time (that step needs the member's own session).
- **Anything tied to money is refused** — hide it instead: listings with an
  order, offer, auction or paid promotion; shops with orders or listings;
  groups and events with payment records.
- **Courses in use are refused** (members' home club, tee times, reviews,
  played-it records, favourites, scorecards, live rounds, groups, posts, shops,
  events). Hide instead.
- **Published or retracted articles stay on the record.**
- A foreign key the guard didn't know about comes back as "still referenced
  elsewhere — hide it instead", never a raw error.

### Show hidden

Groups, events and courses hide hidden rows by default and have a **Show
hidden** toggle. Listings, tee times, users, Social and the review lists
already show everything, with a status filter for the hidden state
("Removed by admin", "Cancelled", "Suspended only", "Hidden only").

## Migration 0140 (`0140_admin_controls.sql`)

Additive, idempotent, rollback in its header.

- `clubs.hidden_at / hidden_by / hidden_reason`; the public read policy is now
  `hidden_at is null` (anon and members), plus a staff (aal2) read policy.
- `groups.hidden_by / hidden_reason` (hidden_at existed; members can't read
  the new columns — column-level grant).
- `society_outings.hidden_at / hidden_by / hidden_reason`; members' read
  policy now requires `hidden_at is null`. Entries, guests, itinerary and
  payments follow (they read through `society_outings`).
- `can_delete_account_for(uuid)` — service role only.

RLS tests: `supabase/tests/rls/admin-controls.test.ts`.

## Known gaps

- Hiding an event doesn't stop an officer who knows its id from calling the
  outing functions on it; members can't see it.
- Deleting a tee time doesn't notify the people who'd asked to join.
- The app's own Admin screen (mobile) doesn't list Groups & societies yet.
