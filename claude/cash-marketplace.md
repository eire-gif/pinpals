# Cash marketplace — used gear without payments (Oct 2026)

**Status: built on branch `cash-marketplace`. Needs migration 0160 applied,
the PR merged (Vercel deploys the website), then `eas update`. No new native
build needed.**

PinPals stops taking payments for used gear. Like Adverts and DoneDeal, it
introduces buyer and seller; they meet (usually at the club) and pay each
other in cash or by Revolut. PinPals keeps the part only it can do: trust —
the seller marks the item sold and names the buyer, and both leave feedback
that shows **in the marketplace only**, never on the golf profile.

Mock-ups: the Design canvas "PinPals marketplace rethink" (screens 1–8).

## The switch

`marketplace_settings.payments_enabled` — one row, **default off**. Read by
`marketplace_payments_enabled()` (public).

| | Off (cash, now) | On (as before 0160) |
|---|---|---|
| Publishing | straight on sale, no Stripe payouts needed | needs Stripe payouts |
| Listing page | How it works · Message · Make offer (= chat with the offer half written) | Buy now, offers, bids, Buyer Protection |
| Offers / bids / Buy now (server) | refused with `PAYMENTS_OFF_MESSAGE` | as before |
| Seller card | % positive · sales, links to the seller page | ★ rating |
| Menu | My ads | My listings, Selling, Buying & orders, Payouts |

Nothing Stripe-shaped was dropped (orders, offers, payouts, reviews), so
switching it back on is a row update, not a migration:

```sql
update public.marketplace_settings set payments_enabled = true, updated_at = now();
```

The app also has a kill switch, `FEATURES.cashMarketplace`: off = the app
behaves as before 0160.

## Database — 0160

- **Messaging a seller.** `can_message()` only allowed connected members,
  offer parties and tee-time partners, which made "Message the seller" fail
  for a stranger. The conversations insert policy now also allows a thread
  tied to an on-sale listing with its seller (`can_message_about_listing`).
  Blocks and `age_guard` still apply.
- **`marketplace_sales`** — one per listing marked sold: buyer (or "sold
  somewhere else"), optional private final price, `buyer_declined_at`.
  Readable by seller, buyer, staff. Written only by `mark_listing_sold()`,
  which only accepts a buyer the seller has a direct thread with.
- **`marketplace_feedback`** — one per side per sale: thumbs up/down, tags
  (CHECK-constrained vocabulary), comment ≤ 500. Hidden from everyone but its
  author until both have left theirs or 7 days pass; open for 30 days.
  Written only by `leave_marketplace_feedback()`. `hidden_at` for moderation
  (service role).
- `decline_marketplace_sale()` — "I didn't buy this": closes feedback and
  withdraws any left.
- Reads: `marketplace_possible_buyers()`, `marketplace_sale_summary()`,
  `marketplace_member_stats()` (public), `marketplace_member_feedback()`
  (public, revealed and visible only).
- `listing_is_visible_row()` also lets the buyer of a sold listing see it.
- Alerts: `marketplace_feedback_due` (buyer, when named) and
  `marketplace_feedback_received` (the other side), both with
  `href: /marketplace/feedback/<sale id>`.

RLS tests: `supabase/tests/rls/cash-marketplace.test.ts` (21).

## App

- **Marketplace bottom menu** (`app/(tabs)/marketplace/_layout.tsx`): Home ·
  Browse · Sell (raised, green) · Chats · My ads. The main tab bar hides while
  you're in the marketplace; Home goes back to it. Under 18s don't get Sell,
  Chats or My ads.
- **Chats** — the inbox filtered to threads about a listing.
- **My ads** — my feedback, "Leave feedback" for sales waiting on me,
  Selling / Sold / Saved, and a "Sold?" button on each live ad.
- **Mark as sold** (`app/mark-sold/[id].tsx`), **Feedback**
  (`app/feedback/[id].tsx`), **Seller page** (`app/seller/[id].tsx`).
- **Sell** posts straight on sale ("Post listing · it's free").
- Conversations accept a `draft` param (Make offer).

## Website

- `/marketplace/[id]` — How it works, Message the seller, Mark as sold for the
  seller, the seller's feedback in place of star reviews.
- `/marketplace/[id]/sold`, `/marketplace/feedback/[saleId]`,
  `/marketplace/sellers/[id]` (Server Actions in `src/app/marketplace/cash-actions.ts`).

## Not done yet

- An admin switch for `payments_enabled` and a moderation queue for
  `marketplace_feedback` (hide via SQL for now).
- Trade sellers' used stock in Used, and importing shop stock from Shopify /
  WooCommerce / Google Shopping feeds (screens 9–11 of the mock-ups).
- The "similar items sold for" price guide (the final prices are being
  collected).
