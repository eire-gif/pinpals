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

## Next

- Stage 2: society screens designed for iPad (two-pane members, board and
  results side by side, itinerary dashboard), from mock-ups; landscape on
  (`orientation` in app.json → needs a new TestFlight build).
- Full-width hero photos on iPad (Home, Marketplace) instead of boxed.
- Stage 3 (optional): the TV board full screen on the iPad.
- App Store: iPad screenshots are needed at submission since iPad is supported.
