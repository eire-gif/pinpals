# Social polish — comments, emoji, video, round cards (9 Oct 2026)

**Status: migration 0111 applied to production 9 Oct 2026. App changes ship
over the air once merged (`eas update --branch production --platform ios`);
the AASA change (links) goes live when Vercel deploys `main`.**

## What members asked for, and what changed

| Ask | Change |
|---|---|
| Invite link doesn't go back to the app | `/signup` and `/c/*` claimed in `src/app/.well-known/apple-app-site-association/route.ts`; routed in `mobile/src/lib/incoming-links.ts` |
| Better scorecard on social posts | Round posts draw as a scorecard — `mobile/src/components/round-card.tsx`; hole-by-hole in `details.hole_pars/hole_scores` (0111) |
| See the photo while commenting | `mobile/src/components/post-media-pane.tsx`, pinned above the comments sheet; shrinks (never hides) with the keyboard; whole photos, swipe for more |
| Long-press a comment to like / emoji | `ReactionMenu` in `comment-thread.tsx`: ❤️ 👍 😂 😮 👏 🔥 ⛳, tap yours again to remove; then Reply / More options. "Like" stays a one-tap heart |
| No "cover" over videos | `post-video.tsx`: the clip's own first frame (paused expo-video player, 1 s buffer); no course photo veil |

## Database — 0111

- `post_comment_likes.emoji` (null = heart, the list checked by
  `post_comment_likes_emoji_ok`); members may update only `emoji`, only on
  their own row. `post_comments.emoji_counts` kept by the like trigger
  (`bump_post_comment_emoji`, callable by nobody). Existing likes backfilled
  as hearts. `like_count` is still "how many reacted".
- `post_details_valid` accepts `hole_pars` + `hole_scores` on rounds: both
  or neither, 9 or 18 entries, pars 3–6, scores 1–15, adding up to the
  score and course par. Mirrors `post-details.ts` (site and app copies).
- RLS tests: `comment-mentions-likes-edits.test.ts` (+2), function grants.
  Whole RLS suite 638/638 on a local replay.
- Applied in two parts because the Supabase tool refuses any batch containing
  DROP; the file uses IF NOT EXISTS blocks so it replays cleanly.

## Not verified

- None of it has been seen on a phone. Check: a round post shared from a
  scorecard, long-press on a comment, a video post in the feed, commenting
  on a photo post with the keyboard up, and a `/c/` link from WhatsApp.
- Video: every video post in view creates a paused player. Fine at today's
  volume; if video posts become common, move to a server-made poster image.
- Android: the new links need the intent filters in `app.json` at the next
  native build (changing app.json now would stop OTA updates).
