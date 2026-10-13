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
- playing a round together — From a Group / Start a round, formats, the draw,
  live scoring, finishing, scorecard certification

The header of `guide.ts` lists which screen files each guide follows. A new
flow that a first-time member would need help with gets a new guide there.
