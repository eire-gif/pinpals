# Incident: listing creation blocked by RLS ("new row violates row-level security policy for table \"listings\"")

**Date:** 2026-09-08
**Reported by:** Eire — "I cant list an advert at the moment?" with a screenshot of the "Save as draft" form showing the error inline.
**Impact:** Every seller on pinpals.ie was unable to create any new listing (draft or otherwise) — 100% failure rate on `POST /rest/v1/listings`. First occurrence found in production logs: 2026-09-07 11:17 (roughly 21 hours before it was reported and fixed).
**Status:** Fixed and verified live. Migration `0052_listing_visibility_returning_fix.sql` applied directly to production (`cicluiabimxklgmpmxmn`) given the severity (every seller blocked), then committed to the repo the same way as every other phase this session.

## Root cause

`0045_marketplace_rls_hardening.sql` introduced `public.listing_is_visible(target_listing_id bigint)` as the single predicate behind the `listings` table's own SELECT policy. Its body re-queries `public.listings` for that same id (`select 1 from public.listings l where l.id = target_listing_id and (...)`) to work out status/seller_id/staff/offer/order visibility.

`createListing()` (`src/app/marketplace/new/actions.ts`) does `supabase.from("listings").insert({...}).select("id").single()` — supabase-js's `.select()` after `.insert()` makes PostgREST issue `INSERT ... RETURNING id`. Postgres re-checks a table's SELECT policy against every row a RETURNING clause returns. For a row inserted earlier in that *same* command, `listing_is_visible()`'s own internal query can't see it yet — a command can't observe its own in-flight insert through a fresh sub-query the way it can through the RETURNING row itself. So the predicate always evaluated `false` for a brand-new listing, and Postgres reported it the standard (if generic-sounding) way: "new row violates row-level security policy for table \"listings\"" — even though the row's `seller_id` genuinely matched the caller.

This is a general Postgres RLS gotcha: a SELECT-policy predicate that re-queries the very table it's protecting cannot see a row that command is still in the middle of inserting. It only bites when the INSERT has a RETURNING clause (which supabase-js's `.select()` always adds) — a bare `INSERT` with no RETURNING was, and still is, unaffected. That split explains why this passed local RLS tests for a day: `supabase/tests/rls/listings.test.ts`'s only pre-existing INSERT test used a plain `INSERT` with no `RETURNING`, so it never exercised the path the real app actually uses.

## Diagnosis

Confirmed directly against production (`cicluiabimxklgmpmxmn`) before writing any fix:

1. `select * from pg_policy where polrelid = 'public.listings'::regclass` — policy definitions were exactly as intended (`with check ((select auth.uid()) = seller_id)`); nothing obviously wrong on paper.
2. `logs` (`postgres_logs` source) showed the literal error recurring since 2026-09-07 11:17, for a genuine, already-authenticated user (confirmed via `edge_logs`: their `GET /rest/v1/listings?seller_id=eq...` calls in the same window succeeded).
3. Reproduced directly with `set_config('request.jwt.claims', ...)` + `set local role authenticated` for that exact seller: a plain `insert into public.listings (...) values (...)` **succeeded**; the identical insert with `returning id` **failed** with the same RLS error.
4. Confirmed `listing_is_visible()` itself works correctly when called against a pre-existing (already-committed) row for the same user — isolating the bug to the RETURNING-triggered SELECT-policy check on a row from the *same* INSERT command, not to the predicate's logic in general.

## Fix

`0052_listing_visibility_returning_fix.sql` adds `public.listing_is_visible_row(target_status text, target_seller_id uuid, target_listing_id bigint)` — the same authorization logic, but driven by the row's own column values (already in hand at policy-evaluation time) instead of re-querying `listings` for them. The `listings` table's SELECT policy now calls this new function with `status`, `seller_id`, `id` directly. `listing_images` and `auctions` keep calling the original `listing_is_visible(listing_id)` unchanged — neither of those tables is ever the row being inserted when their own policy runs, so they never hit this self-visibility gap; only `listings`' own policy needed to stop querying itself.

A regression test was added to `supabase/tests/rls/listings.test.ts` that reproduces the exact supabase-js path (`insert ... returning id`) rather than a bare insert, so this specific gap can't silently reopen.

## Timeline

- Applied directly to production via `apply_migration` given severity (every seller blocked, low-risk/narrowly-scoped fix, straightforward to verify).
- Verified live immediately after: the exact repro from step 3 above now succeeds and returns the new row.
- `get_advisors` (security) re-run post-fix: no new findings beyond the same pre-existing/expected set (the new function gets the same "anon/authenticated can execute this SECURITY DEFINER function" advisory the original `listing_is_visible()` already had — expected and intentional, same as noted for `auction_bid_history` in the `0032`–`0047` catch-up).
- Committed to the repo (migration + replay script + regression test) and delivered as this session's usual patch, since `git push` is blocked in this sandbox by the git proxy.

## Process note

This is the second production incident this week traced to the same underlying gap: local migrations and RLS tests can be fully green while production either lags behind (the `0032`–`0047` catch-up) or, this time, while a bug survives specifically *because* the local test suite's coverage shape (no-RETURNING inserts) didn't match the real app's actual query shape (RETURNING inserts, via supabase-js's `.select()` chaining). Worth flagging for future RLS test-writing: an INSERT policy test should default to including `RETURNING` unless there's a specific reason not to, since that's what the real app almost always does.
