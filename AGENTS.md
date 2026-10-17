<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# PinPals: keep the in-app guides up to date

The app has step-by-step how-to guides (Menu → Help → How-to guides), drawn
from one file: `mobile/src/lib/guide.ts`. They name real buttons on real
screens.

Whenever a change touches any of these flows, update the matching guide steps
in the same change and add a dated line to `GUIDE_CHANGES` in that file:

- starting, joining or running a group (crew, trip, society) — officers,
  join requests, invites, settings, society handicaps
- events and trips — new event, itinerary, payments, entries, the draw
- playing a round together — Groups & Societies / Start a Round, formats, the draw,
  live scoring, finishing, scorecard certification
- tee times — posting one, finding a game, requests, filling an open place
- live scoring, scorecards and the hole map (its drawings are in
  `mobile/src/components/guide-art.tsx` — keep them matching the real map)
- messages and connections, the marketplace (selling, buying, payouts,
  handover) and Social (posts, reactions, comments, sharing, course reviews)

The group guides are written three ways — friends, a golf trip, a society —
with `only` and `as` in `guide.ts`. Check the wording for each, and run
`npx vitest run mobile/src/lib/guide.test.ts`: it fails if a "Take me there"
points at a screen that doesn't exist, or if friends or trips are shown
society-only things.

The header of `guide.ts` lists which screen files each guide follows. A new
flow that a first-time member would need help with gets a new guide there.
