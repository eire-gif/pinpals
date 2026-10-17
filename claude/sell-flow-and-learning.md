# Selling, step by step, and a catalogue that learns from sellers (Oct 2026)

**Status:** built on branch `sell-flow-learning`.
**To ship:** apply migration 0164, merge the PR (Vercel deploys the website), then run `eas update` for iOS and Android. No new native build is needed.

The mock-ups are the "Selling, rebuilt" row on the Design canvas "PinPals — find by brand & model".

## The flow
Selling has six steps, one question each, in the order buyers search:

1. **Photos and a description.** The app needs at least one photo. The quick-add buttons are "How long you've had it", "Any marks" and "What's included".
2. **What is it?**
   - Clubs: Drivers, Woods & hybrids, Irons, Wedges, Putters, Full sets.
   - Everything else golf: Bags, Trolleys, Shoes, Clothing, GPS & rangefinders, Balls, Accessories, Training aids, Something else.
   - Some tiles then ask "Which kind?" (e.g. Electric or Push for trolleys). That answer sets the subcategory, so it also narrows the brand list.
   - In the app, typing it ("tm qi10 driver 10.5 stiff") and tapping Fill in jumps ahead with the later steps filled in.
3. **Brand:**
   - search, plus 9 logo tiles (the first 9 in that category's curated list), then A–Z;
   - "Suggested by members";
   - Not listed — type it / Unbranded / Mixed.
4. **Model:**
   - the catalogue's models, last 5 years first, with "Older models" for the rest;
   - then the exact version;
   - "Suggested by members";
   - Not listed — type it, or Not sure.
5. **Details:** condition (each with a description), then only the fields that kind of item has: loft, shaft flex, shaft, hand, or size for shoes and clothing.
6. **Price and post:**
   - a title written for you (`writeTitle`) that you can edit;
   - price and how you're selling it, plus the "Similar ads" price guide (app only);
   - where it is, and postage or collection;
   - a preview of the ad as buyers will see it.

**Website**
- One `<form>`. Folded steps are hidden, not removed, so a single submit still posts to `createListing()`.
- Finished steps fold to one line with Change, and the preview stays beside the form.
- A server error reopens the step its field belongs to.

**App:** `mobile/src/app/new-listing.tsx` shows one step per screen, with a progress bar and a fixed Back/Next footer.

**Shared rules:** `src/lib/sell-flow.ts` holds the tiles, the title writer, loft choices and condition hints. It is copied byte for byte to the app, and `sell-flow.test.ts` checks the two copies match and that every tile is a real category and subcategory.

## Learning from sellers (migration 0164)
A brand or model a seller types is counted once per seller. The key ignores case, spaces and punctuation; it's `marketplace_norm()` in the database, mirrored by `normKey()` in the code.

- **3 sellers:** it's offered to the next seller under "Suggested by members" (`marketplace_member_suggestions`). The suggestion shows the most common spelling and a count, never who typed it.
- **5 sellers:** it joins the catalogue by itself, through `marketplace_learn()` called from the listings trigger.
  - A model becomes a `marketplace_models` row with `learned = true`.
  - A brand becomes a `marketplace_brands` row with `learned = true` and `categories` set.
  - The ads that used it move under it.
  - There is no approval step; that was the owner's call.
- **Admin → Brands & models → Learned from members:**
  - shows everything that was learned, with a Hide button;
  - also has a "Being typed by sellers now" list, with a count out of 5 for each;
  - anything hidden is recorded as dismissed and is never learned again. Ads that already use it keep it.
- **Learned brands on the server:** `src/lib/learned-brands.ts` loads them into `marketplace-brands.ts` (`setLearnedBrands`), cached for 5 minutes. They're loaded before brands are checked when selling and editing, in `/api/brands`, on the marketplace page and on the sell page, so learned brands are offered and accepted like curated ones.
- **Existing listings:** what they already typed was counted when the migration ran, and anything already typed by 5 sellers was learned then.

## Tests
- `src/lib/sell-flow.test.ts`
- `supabase/tests/rls/marketplace-member-catalogue.test.ts`, which covers:
  - the 3-seller suggestion;
  - learning at 5 sellers, with the ads moving;
  - a hidden item is never re-learned;
  - members can't read or write the votes.
- The function-grants snapshot now includes `listings_catalogue_vote`, `marketplace_learn` and `marketplace_member_suggestions`.

## Not done yet
- The edit form still uses the old single-page layout.
- Trolley battery and charger details go in the description for now.
