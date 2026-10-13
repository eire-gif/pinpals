# In-app how-to guides (Oct 2026)

**Where:** Menu → Help → How-to guides. Shortcut cards on Groups & societies ("New here?" → the guides page), a group's Events (officers) and Live scoring ("First time?").

## Friends, golf trip or society
The guides page asks **Who do you play with?** — Friends, Golf trip or Society — and remembers it on the phone. The group guides are written for that choice: a crew of friends never sees captains, secretaries, join requests or home clubs; a golf trip gets itinerary-first wording. The journey strip changes too (Start a crew → Plan a day out → Play the round, etc.).

## Guides
**Your crew / trip / society:** Set up (Start a crew / Set up your golf trip / Set up a society) · Run your society (society only) · Join (a friend's crew / the trip / a society) · Plan a day out / Plan the trip / Create an event · Play a round together
**Playing golf:** Post a tee time · Find a game · Fill a place in your round · Score a game live · Use the hole map (with drawings of the map)
**Messages & friends:** Find your golf friends · Chat with your PinPals
**Marketplace:** Sell your gear · Buy gear safely
**Social:** Share on Social

Each step: breadcrumb, pictures of the real buttons, who's allowed, a tip, "Take me there" where possible. **All guides** and **Finish** go back to the guides page.

## Files
- `mobile/src/lib/guide.ts` — all content; `only` / `as` per audience; `GUIDE_CHANGES`
- `mobile/src/lib/guide-audience.ts` — the saved choice
- `mobile/src/components/guide-art.tsx` — hole map drawings (plain Views; no SVG library in the app)
- `mobile/src/app/guide/index.tsx`, `[id].tsx`, `components/guide-bits.tsx`
- `mobile/src/lib/guide.test.ts` — every "Take me there" is a real screen; friends/trips never see society-only words

## Standing rule
Any change to a flow a guide covers updates the guide in the same change and adds a dated line to `GUIDE_CHANGES` (also in the repo's `AGENTS.md`).
