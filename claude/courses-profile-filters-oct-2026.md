# Courses, Profile and the marketplace filter — the Tee Times look (10 Oct 2026)

**Status: 0112 applied to production 10 Oct 2026. The cover-photo upload route goes live when Vercel deploys `main`; the app ships over the air (`eas update --branch production --platform ios`).**

## The look

`mobile/src/components/photo-hero.tsx` — the Tee Times header, for any screen:
a full-bleed photograph behind the status bar and a see-through navigation
bar (`headerTransparent`), the title on it, a darker foot so white text holds
on any photo, and an optional card overlapping its bottom edge. Collapses with
`useCollapsingHeader()`.

## Courses

- Photo hero (Old Head) with the search and chips in a white card over it.
- **Favourites**: a star on every course card and in the course page's
  header; a **Favourites** chip first in the row lists them (newest first).
  Unstarring on that tab removes the card at once. `lib/club-favourites.ts`.
- Cards: course photograph (`coursePhoto`), name, town, stars, distance and
  member-count pills.

## Profile

- The member's **cover photo** across the top (default: Links at sunset), a
  **Cover** button to take/choose one or go back to the default.
- An overlapping card: photo (tap → Edit profile), handicap, My profile and
  Edit. Menu grouped into Golf / People / Marketplace / Account, with My
  scorecards and Courses & favourites added.
- The member page (what others see) shows the cover too, face overlapping it.

## Marketplace filter sheet

Photograph band ("Find your gear", N filters on); each group in a card with
an icon and a Clear link; sort as a segmented control; categories as picture
tiles (shared with List an item, `lib/listing-icons.ts`); brands only once a
category is chosen, searchable from ten; condition, selling and delivery as
icon cards with a hint ("Barely a mark", "Bid or buy", "Pick it up"); quick
price bands (Under €50 … €300+) plus From/To; counties folded to twelve with
"Show all"; "Show results" with a gold count badge.

## Database — 0112

- `club_favourites (member_id, club_id)` — private: select/insert/delete
  own rows only; anon nothing. RLS test `club-favourites.test.ts` (3).
- `profiles.cover_url` — written by `POST /api/app/profile/cover`
  (`src/app/api/app/profile/cover/route.ts`): sharp re-encode, 1600 px, no
  metadata, into the member's own folder of `member-avatars` (≤ 2 MB);
  `remove=on` resets it. Rate-limited 20/hour.

## Not verified

- Not yet seen on a phone. The cover upload needs the website deployed
  first (merge does that); before then the Cover button will error.
- Android: transparent headers over photos look as on iOS in principle,
  unchecked.
