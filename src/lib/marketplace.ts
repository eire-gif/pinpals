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
