import { describe, expect, it } from "vitest";
import { createListingSchema, updateListingSchema } from "./listing";

const baseFields = {
  title: "TaylorMade Stealth 2 Driver",
  description: "Barely used, one season only.",
  category: "Drivers",
  subcategory: "Standard",
  condition: "Excellent",
  county: "Kerry",
  deliveryOptions: ["post", "collection"],
  collectionNotes: "Available evenings and weekends.",
};

describe("createListingSchema — fixed_price / offers_allowed", () => {
  it("accepts a valid fixed-price listing", () => {
    const result = createListingSchema.safeParse({
      ...baseFields,
      saleType: "fixed_price",
      priceEur: "220",
    });
    expect(result.success).toBe(true);
  });

  it("accepts a valid offers-allowed listing", () => {
    const result = createListingSchema.safeParse({
      ...baseFields,
      saleType: "offers_allowed",
      priceEur: 199.5,
    });
    expect(result.success).toBe(true);
  });

  it("rejects a non-positive price", () => {
    const result = createListingSchema.safeParse({
      ...baseFields,
      saleType: "fixed_price",
      priceEur: 0,
    });
    expect(result.success).toBe(false);
  });

  it("rejects a price with more than 2 decimal places", () => {
    const result = createListingSchema.safeParse({
      ...baseFields,
      saleType: "fixed_price",
      priceEur: 19.999,
    });
    expect(result.success).toBe(false);
  });

  it("rejects a title shorter than 3 characters", () => {
    const result = createListingSchema.safeParse({
      ...baseFields,
      title: "Hi",
      saleType: "fixed_price",
      priceEur: 10,
    });
    expect(result.success).toBe(false);
  });

  it("rejects an unrecognised category", () => {
    const result = createListingSchema.safeParse({
      ...baseFields,
      category: "Skateboards",
      saleType: "fixed_price",
      priceEur: 10,
    });
    expect(result.success).toBe(false);
  });

  it("rejects a subcategory that doesn't belong to the chosen category", () => {
    const result = createListingSchema.safeParse({
      ...baseFields,
      category: "Putters",
      subcategory: "Fairway woods",
      saleType: "fixed_price",
      priceEur: 10,
    });
    expect(result.success).toBe(false);
  });

  it("requires at least one delivery option", () => {
    const result = createListingSchema.safeParse({
      ...baseFields,
      deliveryOptions: [],
      saleType: "fixed_price",
      priceEur: 10,
    });
    expect(result.success).toBe(false);
  });
});

describe("createListingSchema — auction", () => {
  const startsAt = "2026-10-01T10:00:00.000Z";
  const endsAt = "2026-10-03T10:00:00.000Z"; // 48h later

  it("accepts a valid auction listing", () => {
    const result = createListingSchema.safeParse({
      ...baseFields,
      saleType: "auction",
      startingPriceEur: "50",
      minIncrementEur: "5",
      startsAt,
      endsAt,
    });
    expect(result.success).toBe(true);
  });

  it("accepts an optional reserve at or above the starting price", () => {
    const result = createListingSchema.safeParse({
      ...baseFields,
      saleType: "auction",
      startingPriceEur: 50,
      reservePriceEur: 50,
      minIncrementEur: 5,
      startsAt,
      endsAt,
    });
    expect(result.success).toBe(true);
  });

  it("rejects a reserve below the starting price", () => {
    const result = createListingSchema.safeParse({
      ...baseFields,
      saleType: "auction",
      startingPriceEur: 50,
      reservePriceEur: 40,
      minIncrementEur: 5,
      startsAt,
      endsAt,
    });
    expect(result.success).toBe(false);
  });

  it("rejects an end time before the start time", () => {
    const result = createListingSchema.safeParse({
      ...baseFields,
      saleType: "auction",
      startingPriceEur: 50,
      minIncrementEur: 5,
      startsAt: endsAt,
      endsAt: startsAt,
    });
    expect(result.success).toBe(false);
  });

  it("rejects a window shorter than the minimum duration", () => {
    const result = createListingSchema.safeParse({
      ...baseFields,
      saleType: "auction",
      startingPriceEur: 50,
      minIncrementEur: 5,
      startsAt,
      endsAt: "2026-10-01T10:30:00.000Z", // 30 minutes later
    });
    expect(result.success).toBe(false);
  });

  it("rejects a buyNowPriceEur field on a plain auction (not this sale type's shape)", () => {
    const result = createListingSchema.safeParse({
      ...baseFields,
      saleType: "auction",
      startingPriceEur: 50,
      minIncrementEur: 5,
      buyNowPriceEur: 200,
      startsAt,
      endsAt,
    });
    // Extra/unknown keys on a specific union branch are simply ignored by
    // zod's default (non-strict) object parsing — this asserts that
    // behaviour explicitly rather than assuming it, since the create action
    // relies on it to safely accept one shared form payload across sale
    // types.
    expect(result.success).toBe(true);
  });
});

describe("createListingSchema — auction_with_buy_now", () => {
  const startsAt = "2026-10-01T10:00:00.000Z";
  const endsAt = "2026-10-03T10:00:00.000Z";

  it("accepts a Buy It Now price above the starting price", () => {
    const result = createListingSchema.safeParse({
      ...baseFields,
      saleType: "auction_with_buy_now",
      startingPriceEur: 50,
      buyNowPriceEur: 150,
      minIncrementEur: 5,
      startsAt,
      endsAt,
    });
    expect(result.success).toBe(true);
  });

  it("rejects a Buy It Now price at or below the starting price", () => {
    const result = createListingSchema.safeParse({
      ...baseFields,
      saleType: "auction_with_buy_now",
      startingPriceEur: 50,
      buyNowPriceEur: 50,
      minIncrementEur: 5,
      startsAt,
      endsAt,
    });
    expect(result.success).toBe(false);
  });

  it("rejects a Buy It Now price at or below an explicit reserve", () => {
    const result = createListingSchema.safeParse({
      ...baseFields,
      saleType: "auction_with_buy_now",
      startingPriceEur: 50,
      reservePriceEur: 100,
      buyNowPriceEur: 100,
      minIncrementEur: 5,
      startsAt,
      endsAt,
    });
    expect(result.success).toBe(false);
  });

  it("requires a Buy It Now price", () => {
    const result = createListingSchema.safeParse({
      ...baseFields,
      saleType: "auction_with_buy_now",
      startingPriceEur: 50,
      minIncrementEur: 5,
      startsAt,
      endsAt,
    });
    expect(result.success).toBe(false);
  });
});

describe("updateListingSchema", () => {
  it("accepts a partial edit payload with only some fields present", () => {
    const result = updateListingSchema.safeParse({ title: "Updated title here" });
    expect(result.success).toBe(true);
  });

  it("accepts an empty payload (no fields being changed)", () => {
    expect(updateListingSchema.safeParse({}).success).toBe(true);
  });

  it("still validates a present field's own constraints", () => {
    const result = updateListingSchema.safeParse({ title: "Hi" });
    expect(result.success).toBe(false);
  });
});

// ============ brand + item specification (0060) ============

const fixedPriceBase = { ...baseFields, saleType: "fixed_price" as const, priceEur: "220" };

function firstIssuePath(result: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }) {
  return result.error?.issues[0]?.path[0];
}

describe("createListingSchema — brand", () => {
  it("accepts a listing with no brand at all", () => {
    // The whole field is optional by design — see the header comment on the
    // brand block in ./listing.ts.
    expect(createListingSchema.safeParse(fixedPriceBase).success).toBe(true);
  });

  it("accepts a brand that belongs to the category", () => {
    const result = createListingSchema.safeParse({ ...fixedPriceBase, brand: "taylormade" });
    expect(result.success).toBe(true);
  });

  it("rejects a brand from a different category", () => {
    const result = createListingSchema.safeParse({ ...fixedPriceBase, brand: "motocaddy" });
    expect(result.success).toBe(false);
    expect(firstIssuePath(result)).toBe("brand");
  });

  it("rejects a brand excluded by the subcategory", () => {
    const result = createListingSchema.safeParse({
      ...fixedPriceBase,
      category: "Balls & accessories",
      subcategory: "Golf balls",
      brand: "bushnell",
    });
    expect(result.success).toBe(false);
    expect(firstIssuePath(result)).toBe("brand");
  });

  it("requires a name behind Other", () => {
    const result = createListingSchema.safeParse({ ...fixedPriceBase, brand: "other" });
    expect(result.success).toBe(false);
    expect(firstIssuePath(result)).toBe("brandOther");
  });

  it("accepts Other with a name", () => {
    const result = createListingSchema.safeParse({
      ...fixedPriceBase,
      brand: "other",
      brandOther: "Geoff's Custom Clubs",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a typed brand name alongside a real brand", () => {
    // Mirrors listings_brand_other_requires_other_check — two contradictory
    // answers to "what brand is this?" must never reach the database.
    const result = createListingSchema.safeParse({
      ...fixedPriceBase,
      brand: "taylormade",
      brandOther: "Actually a PING",
    });
    expect(result.success).toBe(false);
    expect(firstIssuePath(result)).toBe("brandOther");
  });

  it("accepts Unknown / unbranded with no name", () => {
    expect(createListingSchema.safeParse({ ...fixedPriceBase, brand: "unknown" }).success).toBe(true);
  });

  it("rejects Mixed brands outside the categories that allow it", () => {
    expect(createListingSchema.safeParse({ ...fixedPriceBase, brand: "mixed" }).success).toBe(false);
    expect(
      createListingSchema.safeParse({
        ...fixedPriceBase,
        category: "Full sets",
        subcategory: "Men's set",
        brand: "mixed",
      }).success
    ).toBe(true);
  });
});

describe("createListingSchema — item specification", () => {
  it("accepts the full spec set", () => {
    const result = createListingSchema.safeParse({
      ...fixedPriceBase,
      brand: "taylormade",
      model: "Stealth 2 Plus",
      dexterity: "Left-handed",
      shaftFlex: "Stiff",
      shaftMaterial: "Graphite",
      loft: "10.5°",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a value outside a closed spec vocabulary", () => {
    const result = createListingSchema.safeParse({ ...fixedPriceBase, shaftFlex: "Very bendy" });
    expect(result.success).toBe(false);
    expect(firstIssuePath(result)).toBe("shaftFlex");
  });

  it("rejects an over-long model", () => {
    const result = createListingSchema.safeParse({ ...fixedPriceBase, model: "x".repeat(200) });
    expect(result.success).toBe(false);
    expect(firstIssuePath(result)).toBe("model");
  });
});

describe("updateListingSchema — brand", () => {
  it("applies the same category rule as creation", () => {
    expect(updateListingSchema.safeParse({ category: "Wedges", brand: "motocaddy" }).success).toBe(false);
    expect(updateListingSchema.safeParse({ category: "Wedges", brand: "cleveland" }).success).toBe(true);
  });

  it("still catches a stray brand name with no category to check against", () => {
    const result = updateListingSchema.safeParse({ brand: "taylormade", brandOther: "Something else" });
    expect(result.success).toBe(false);
    expect(firstIssuePath(result)).toBe("brandOther");
  });

  it("accepts an edit that touches nothing", () => {
    expect(updateListingSchema.safeParse({}).success).toBe(true);
  });
});
