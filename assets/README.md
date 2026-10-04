# Server-side assets

Read from disk by route handlers and image routes at request time (Node
runtime, `join(process.cwd(), "assets/…")`), never served directly.

- `fonts/` — Playfair Display 700 and Public Sans 400/600, the site's two
  faces, for the share card (`src/app/s/[token]/opengraph-image.tsx`).
  SIL Open Font License 1.1, copied from @expo-google-fonts.
- `share/course-1…6.jpg` — course photographs for share cards, 1200×630.
  A card never uses a member's own photo; it picks one of these per course
  (`src/lib/share-card.ts`, `SHARE_PHOTOS`).
