import { describe, it, expect } from "vitest";
import { decide, nameMatches, numberMatches, type CardReading, type Claimed } from "./decide";

const claimed: Claimed = { firstName: "Seán", lastName: "O'Brien", club: "Portmarnock Golf Club", number: "1234 5678" };

const card = (over: Partial<CardReading> = {}): CardReading => ({
  is_membership_card: true,
  card_type: "golf_ireland_card",
  legible: true,
  looks_altered: false,
  name_on_card: "SEAN O BRIEN",
  club_on_card: "Portmarnock GC",
  number_on_card: "12345678",
  club_matches: true,
  confidence: 0.95,
  ...over,
});

describe("nameMatches", () => {
  it("allows accents, apostrophes, spacing and initials", () => {
    expect(nameMatches("SEAN O BRIEN", "Seán", "O'Brien")).toBe(true);
    expect(nameMatches("S. OBRIEN", "Seán", "O'Brien")).toBe(true);
    expect(nameMatches("Pat Murphy", "Patrick", "Murphy")).toBe(true);
  });

  it("refuses a different person", () => {
    expect(nameMatches("Mary O'Brien", "Seán", "O'Brien")).toBe(false);
    expect(nameMatches("Sean Murphy", "Seán", "O'Brien")).toBe(false);
    expect(nameMatches("O'BRIEN", "Seán", "O'Brien")).toBe(false);
  });
});

describe("numberMatches", () => {
  it("ignores spaces and a printed prefix", () => {
    expect(numberMatches("GUI 12345678", "1234 5678")).toBe(true);
    expect(numberMatches("12345679", "12345678")).toBe(false);
    expect(numberMatches(null, "12345678")).toBe(false);
  });
});

describe("decide", () => {
  it("approves a clear match", () => {
    expect(decide(card(), claimed).outcome).toBe("approve");
  });

  it("approves the Golf Ireland app screen without a number", () => {
    expect(decide(card({ card_type: "golf_ireland_app", number_on_card: null }), claimed).outcome).toBe("approve");
  });

  it("sends a plastic card with no readable number to a person", () => {
    expect(decide(card({ number_on_card: null }), claimed).outcome).toBe("review");
  });

  it("rejects a photo that clearly isn't a card", () => {
    expect(decide(card({ is_membership_card: false, card_type: "other" }), claimed).outcome).toBe("reject");
  });

  it("asks a person when the model isn't sure", () => {
    expect(decide(card({ confidence: 0.6 }), claimed).outcome).toBe("review");
    expect(decide(card({ is_membership_card: false, confidence: 0.4 }), claimed).outcome).toBe("review");
  });

  it("never approves a card that looks edited, or someone else's", () => {
    expect(decide(card({ looks_altered: true }), claimed).outcome).toBe("review");
    const other = decide(card({ name_on_card: "Mary Kelly" }), claimed);
    expect(other).toMatchObject({ outcome: "review", reason: expect.stringContaining("name") });
  });

  it("asks for a better photo when it can't be read", () => {
    expect(decide(card({ legible: false }), claimed).outcome).toBe("reject");
  });
});
