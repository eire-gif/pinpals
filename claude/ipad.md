# iPad (Oct 2026)

The app has always installed on iPad (`supportsTablet: true` in app.json),
portrait only, with phone layouts stretched across the screen.

## Stage 1 — a tidy column everywhere (this change)

- `MAX_CONTENT_WIDTH` (680) and `contentColumn` in `lib/theme.ts`. The root
  stack, the tab scenes, the live-scoring stack and onboarding put every
  screen's content in a centred column that wide. A phone is narrower than
  680, so nothing changes on iPhone.
- Full width on purpose: the `(tabs)` screen itself (so the tab bar spans the
  screen; the tabs centre their own content), the hole map, and log in /
  sign up / confirm (full navy; the form keeps to `AUTH_COLUMN`, 520).
- `useContentWidth()` / `contentWidthNow()` (`lib/content-width.ts`) replace
  `useWindowDimensions()` for anything sized inside a screen (feed and post
  photos, grids, chips, the listing gallery, the guides), so they size to the
  column. Full-screen overlays (photo viewer, reaction picker, menu drawer)
  still measure the window.
- 680 sits inside an iPad page sheet, so modals fit.
- Checked in a web preview at iPad (820×1180) and iPhone (393×852) sizes:
  log in, Home, Marketplace, the guides.

JS only: `eas update` delivers it; no new build.

## Stage 2 — side by side on an iPad on its side (Oct 2026)

Mock-ups: canvas *PinPals iPad Society Screens* (5 boards).

- **Landscape and Split View were already on.** With `orientation: portrait`
  and `supportsTablet: true`, Expo's prebuild writes portrait-only for iPhone
  but all four orientations for iPad (`UISupportedInterfaceOrientations~ipad`)
  and `UIRequiresFullScreen` false — checked by running `expo prebuild` on a
  copy. So iPads already turn and multitask; no new build was needed.
- `useWideLayout()` (window ≥ 900 pt: an iPad on its side, or a wide Split
  View) and `<TwoPane>` (`components/two-pane.tsx`). Narrower than that —
  every phone, an iPad upright — the same blocks stack in the order they
  always did.
- Two columns, up to 1,240 pt wide (`pageColumn`), on:
  - the group / society page — about, what you owe, noticeboard, committee
    tools, events on the left; past results, join requests and members on
    the right
  - an event — details, itinerary, paying on the left; requests, waiting
    list and who's in on the right
  - the day board (society day, scramble, match day) — the leaderboard or
    matches on the left; the day, calendar, Show on TV and results on the
    right
- Those screens set `contentStyle: FULL_WIDTH_CONTENT` (and the live tab's
  `sceneStyle`) so they can be wider than the 680 column.

## Next

- Members as list + detail (mock-up 2) and the group's hole-by-hole card
  beside the day board (mock-up 4).
- Full-width hero photos on iPad (Home, Marketplace) instead of boxed.
- Stage 3 (optional): the TV board full screen on the iPad.
- App Store: iPad screenshots are needed at submission since iPad is supported.
