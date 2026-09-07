export const CATEGORIES = [
  "Drivers",
  "Woods & hybrids",
  "Irons",
  "Wedges",
  "Putters",
  "Full sets",
  "Bags & trolleys",
  "Shoes & apparel",
  "Balls & accessories",
] as const;

export const CONDITIONS = [
  "New / unused",
  "Excellent",
  "Good",
  "Fair",
] as const;

// The cut Pinpals takes on a completed sale, shown to the buyer as a
// line-item on top of the agreed price (same pattern as Vinted's buyer fee).
export const PLATFORM_FEE_RATE = 0.07;

export function computeOfferTotal(amountEur: number) {
  const fee = Math.round(amountEur * PLATFORM_FEE_RATE * 100) / 100;
  const total = Math.round((amountEur + fee) * 100) / 100;
  return { amount: amountEur, fee, total };
}

// ============ Seller reputation (derived, read-only) ============
// Both of these are pure math over rows the seller-readiness page
// (src/app/dashboard/payouts/page.tsx) already reads from existing tables —
// `reviews` (0041) and `offers` (0003/0032) — deliberately not a new table
// or column of their own, same "don't invent what you can derive" discipline
// as sellerOnboardingStatus() in src/lib/stripe/connect.ts.

/** Average + count from a seller's review ratings (1-5 each, see
 * 0041_reviews.sql's check constraint). `null` — not 0 — when there are no
 * reviews yet, so the UI can show "No reviews yet" rather than implying a
 * zero-star reputation. */
export function summarizeRatings(ratings: number[]): { average: number; count: number } | null {
  if (ratings.length === 0) return null;
  const sum = ratings.reduce((total, rating) => total + rating, 0);
  // One decimal place (e.g. 4.7) — matches how star ratings are conventionally shown.
  return { average: Math.round((sum / ratings.length) * 10) / 10, count: ratings.length };
}

/** Percentage of offers a seller has responded to (accepted or declined,
 * i.e. anything other than still-`pending`) out of every offer ever made on
 * their listings. `null` — not 0 — when they've never received an offer, so
 * a brand-new seller isn't shown a misleading "0% response rate". */
export function computeResponseRate(totalOffers: number, respondedOffers: number): number | null {
  if (totalOffers === 0) return null;
  return Math.round((respondedOffers / totalOffers) * 100);
}
