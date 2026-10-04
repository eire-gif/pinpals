# Code quality rules, and how the feed redesign meets them

Feed redesign, phase 12 (Oct 2026). These rules apply to all PinPals work
from here on. The table records how PR #119 (phases 1–11) was audited
against each, and what phase 12 fixed.

## The rules

1. Never rewrite working major systems unnecessarily.
2. Reuse existing API and services.
3. Reuse existing design tokens.
4. Create reusable components rather than screen-specific duplicates.
5. Centralise post type, reaction and achievement definitions.
6. Keep UI state separate from backend state.
7. Handle loading, error and empty states.
8. Preserve old post compatibility.
9. Preserve existing user, post, comment and round IDs.
10. Make database migrations backward compatible.
11. Don't delete legacy fields until all old app versions are no longer relevant.
12. Add feature flags for major unfinished features where appropriate.
13. Avoid changing authentication.
14. Avoid changing payments.
15. Avoid changing unrelated Tee Times or Marketplace functionality.

## Audit of phases 1–11

| # | Rule | Finding | Phase 12 action |
|---|---|---|---|
| 1 | No needless rewrites | Feed, comments, likes, messaging and tee times were all extended in place: `post_likes` became reactions; comments gained columns; share-into-chat uses existing messaging; recaps read existing tee times | — |
| 2 | Reuse API/services | Writes go through the existing `/api/app/posts/*` routes and `feed-operations.ts`; reads through `feed.ts` under RLS; notifications through the existing seam; sharing into chat through existing conversations | — |
| 3 | Design tokens | New components used `colors`/`fonts`/`radii`/`spacing`, **but** navy/cream overlays were hand-typed `rgba()` in four components, and one `borderRadius: 999` | **Fixed:** `navyAlpha()` / `creamAlpha()` in `theme.ts`, derived from the tokens and used everywhere; `radii.pill`. `reactions.ts` keeps literal colours because it's shared byte-for-byte with the website and can't import app code (its header says so) |
| 4 | Reusable components | `PostCard`, `AchievementCard`, `RoundRecapCard`, `CommentThread`, `ReactionPicker` and the profile sections are each one component used by several screens. **But** the "not available" block was copy-pasted in the post screen, the comments sheet and the profile sections | **Fixed:** `components/state-message.tsx` (`StateMessage`, `LoadError`) used by all three |
| 5 | Central definitions | One file each, mirrored website ↔ app with drift tests: `post-details.ts` (types, kinds, fields, validation), `reactions.ts`, `achievements.ts`, plus `shared-round.ts` and `groups.ts`. Database checks mirror them. **But** two screens spelled out "Round/Hole/Shot" themselves | **Fixed:** `POST_KIND_LABELS` in `post-details.ts`, used by the highlight tiles and share text |
| 6 | UI state ≠ backend state | The composer edits a string `DetailsDraft`, converted to stored `details` only on Post (`draftToDetails`). Reactions, saves and comment likes are optimistic, then replaced by the server's numbers and rolled back on failure (`use-post-actions.ts`). Recap "Not now" is phone-only state | — |
| 7 | Loading / error / empty | Feed, saved, share, composer: all three handled. **But** `loadPost` ignored query errors, so a network failure on the post screen or comments sheet said "may have been deleted". Profile sections turned failures into "hasn't shared anything", and the share screen had two unhandled promises | **Fixed:** `loadPost` throws on a real error; the post screen, comments sheet and every profile section show **Try again**; profile loaders throw on real errors (a database without the newer columns, code 42703, still means empty); share-screen promises are caught |
| 8 | Old post compatibility | `posts.kind` defaults to `general`; `details` is nullable; old likes became Great Shots; `selectPosts`/`selectComments` fall back to the old columns on 42703, so an app update ahead of the migrations still loads the feed | — |
| 9 | Preserve IDs | No table was recreated or re-keyed. Comments, replies and likes kept their IDs; recaps reference the existing tee-time ID; shared rounds and groups are designed around existing IDs | — |
| 10 | Backward-compatible migrations | 0094–0101 are additive only: new tables, new columns with defaults or nullable, new functions. No drops, renames or type changes. `drop … if exists` lines only re-create policies and constraints these migrations own. Old app builds insert without the new columns and get the defaults | — |
| 11 | Keep legacy fields | Nothing removed. Pair columns on conversations (0087), `like_count`, comment shape and the old like route all remain | — |
| 12 | Feature flags | None existed | **Added** `mobile/src/lib/features.ts`. **Kill switches** (on): `recapPrompts`, `achievementClaims`, `profileSections`; switching one off removes the entry point without touching data. **Gates** (off): `groups`, `sharedRounds`, `shotMaps`, `video`. `features.test.ts` fails if a gate is switched on. Post types keep their own `status` rollout in `post-details.ts` |
| 13 | Authentication | Not touched | — |
| 14 | Payments | Not touched | — |
| 15 | Unrelated Tee Times / Marketplace | Additive only: a "Share your round" button on played rounds, two extra columns read in `rounds.ts`, and the course-photo list moved to `components/course-photos.ts` (same images, now shared). No behaviour changed | — |

## How to flip a flag

Edit `mobile/src/lib/features.ts`. For a gate, also update
`features.test.ts`, which is deliberate friction. Then:

```
cd mobile && eas update --branch production --platform ios -m "Flag: <name> <on|off>"
```

Turning a kill switch off hides the entry point only. Posts, achievements and
profile data already saved keep displaying.
