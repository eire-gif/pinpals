# Find by club, brand and model, with Top picks (Oct 2026)

**Status: built on branch `marketplace-finder-top-picks`. Needs migration 0163 applied, the PR merged (Vercel deploys the website), then `eas update`. No new native build.**

Mock-ups: the Design canvas "PinPals — find by brand & model". The flow row was approved, with the paid row renamed: the row is called **Top picks** and each advert in it carries a **PREMIUM** badge.

## The flow
- Buyers find gear in three steps: **club type or item → brand → model**. Each step shows how many are for sale.
- The listings are always on screen underneath, and they narrow as each step is picked.
- Any step can be skipped. Tapping a finished step goes back to it.
- **Top picks** sits above the listings. It shows up to 3 paid adverts that match what's picked.
  - Premium Plus adverts come first.
  - The rest take turns, with the order changing every 10 minutes.
  - An advert in Top picks isn't repeated in the list below.
  - If nothing matching is paid for, the row isn't shown.
- **Website:**
  - The flow is on `/marketplace`, and the state lives in the URL: `?category=Drivers&brand=taylormade&model=taylormade-qi10`.
  - `/marketplace/brands` is "Shop by brand": brand logos, most-for-sale first, then A–Z.
- **App:** the flow is on the Browse tab (`components/gear-finder.tsx`), with the Top picks rail under it.

## Paying for Top picks
| Tier | Price | What it gets | DB kind |
|---|---|---|---|
| Premium | €1.99 | 3 days in Top picks, plus back to the top of Newest | `bump` |
| Premium Plus | €4.99 | 7 days in Top picks, shown first, gold Premium badge everywhere | `featured` |

- The database kinds keep their names from 0115, so past payments, the webhook and the revenue figures are unchanged.
- `activate_listing_promotion` now sets `listings.top_pick_until`. Premium Plus also sets `featured_until`.
- Members can't write `top_pick_until`: the same guard trigger as `featured_until` (0117) covers it.
- Adverts are bought on the website only, at `/dashboard/listings/[id]/promote`, now titled "Get your advert seen first". This is because of App Store rule 3.1.1.
- The app shows an information card on your own advert. It has no link, no button and no price.
- The website's "Get it into Top picks" card on the listing page now shows in cash-marketplace mode too. Top picks is paid to PinPals by card, separately from buyer–seller payments.
- When admin cancels a placement, the advert comes out of Top picks and loses the badge, unless another placement on it is still running.

## Catalogue and logos (migration 0163)
- `marketplace_models`:
  - One row per brand, category and model family, with its launch year and versions.
  - 407 rows, seeded from `src/data/golf-models.json`. That file is generated; extend it, or add models in Admin.
  - Covers the main club brands back to about 2007, plus trolleys and rangefinders.
  - Anyone can read it; only the service role writes to it.
- `marketplace_brands.logo_url`:
  - Points to the official logo, uploaded in **Admin → Brands & models** into the public `brand-logos` bucket.
  - Until a logo is uploaded, the brand's name shows instead.
  - Writes to brands now fail with permission denied, instead of silently doing nothing.
- `listings.model_id`:
  - Optional link to a catalogue model. The free-text `model` field stays, for the exact version.
  - The `listings_check_model` trigger keeps it matching the listing's brand and category. If the brand changes, a model that no longer fits is dropped.
  - Existing listings were matched to models from their model text and title.
- `search_marketplace_listings(..., p_model)`: rewritten from the live definition, as 0116 was. The old 15-argument version is dropped.
- `marketplace_finder_counts(p_category, p_brand)`: counts and asking-price ranges per club type, brand and model.

## Selling
- **Website:** when the brand has catalogue models, a "Which model?" select appears. Once a model is picked, the free-text field becomes "Exact version", with that model's versions suggested.
- **App:** a Model section is added, filled in from the title when it can be (`matchModel`).
- **From the finder:** "Selling a Qi10? List it" opens the sell form with the club type, brand and model already filled in.

## Code
- `src/lib/finder.ts` holds the shared rules: steps, counts, which adverts fill Top picks, and matching a title to a model. It is copied byte for byte to `mobile/src/lib/finder.ts`, and `finder.test.ts` checks the two match.
- Website:
  - `src/lib/marketplace-finder.ts`
  - `src/app/marketplace/finder.tsx`
  - `src/app/marketplace/brands/page.tsx`
  - `src/app/admin/brands/*`
  - `src/components/marketplace/model-picker.tsx`
- App:
  - `mobile/src/lib/gear-finder.ts`
  - `mobile/src/components/gear-finder.tsx`
  - `mobile/src/components/top-picks-info.tsx`
- Every finder loader returns nothing rather than failing, so the listings still load on a database without 0163.
- Tests:
  - `src/lib/finder.test.ts` covers the rules and checks the catalogue against the migration seed.
  - `supabase/tests/rls/marketplace-catalogue.test.ts` (4 tests).
  - The in-app guides "Buy gear safely" and "Sell your gear" are updated.

## Not done yet
- No official logos are uploaded yet. They need to come from each brand's media or press kit, uploaded in Admin → Brands & models.
- Model pages don't have their own URL beyond the finder's query string.
- There's no "alert me when a Qi10 is listed" yet.
