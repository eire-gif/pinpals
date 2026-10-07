import { describe, expect, it } from "vitest";

import { settledReason, type InterestNow } from "./request-settled";

const TODAY = "2026-10-07";
const OFFER = "tee_time_place_offered";
const REQUEST = "tee_time_interest_received";
const at = (status: InterestNow["status"], invite: string | null = "open", date = "2026-10-11"): InterestNow => ({
  id: 36,
  status,
  tee_time_invites: invite ? { status: invite, play_date: date } : null,
});

describe("settledReason: an offer of a place", () => {
  it("still wants an answer while it is offered and the round is ahead", () => {
    expect(settledReason(OFFER, at("accepted"), TODAY)).toBeNull();
    expect(settledReason(OFFER, at("accepted", "full"), TODAY)).toBeNull();
    expect(settledReason(OFFER, at("accepted", "open", TODAY), TODAY)).toBeNull(); // today's round
  });

  it("is settled once confirmed — the Grange Castle case, confirmed 19 seconds after the alert", () => {
    expect(settledReason(OFFER, at("confirmed"), TODAY)).toBe("You confirmed your place");
  });

  it("is settled when given back, withdrawn, cancelled, played or gone", () => {
    expect(settledReason(OFFER, at("declined"), TODAY)).toBe("You gave this place back");
    expect(settledReason(OFFER, at("pending"), TODAY)).toBe("This offer was withdrawn");
    expect(settledReason(OFFER, at("accepted", "cancelled"), TODAY)).toBe("This round was cancelled");
    expect(settledReason(OFFER, at("accepted", "open", "2026-10-06"), TODAY)).toBe("This round has been played");
    expect(settledReason(OFFER, at("accepted", "completed"), TODAY)).toBe("This round has been played");
    expect(settledReason(OFFER, at("accepted", null), TODAY)).toBe("This round is no longer available");
    expect(settledReason(OFFER, undefined, TODAY)).toBe("This offer is no longer available");
  });
});

describe("settledReason: a request to join your round", () => {
  it("wants an answer only while pending on a live round", () => {
    expect(settledReason(REQUEST, at("pending"), TODAY)).toBeNull();
    expect(settledReason(REQUEST, at("accepted"), TODAY)).toBe("You accepted this request");
    expect(settledReason(REQUEST, at("confirmed"), TODAY)).toBe("You accepted this request");
    expect(settledReason(REQUEST, at("declined"), TODAY)).toBe("This request is closed");
    // A pending request on a round the host has since cancelled (seen in production, 6 Oct).
    expect(settledReason(REQUEST, at("pending", "cancelled", "2026-10-06"), TODAY)).toBe("This round was cancelled");
    expect(settledReason(REQUEST, undefined, TODAY)).toBe("This request was withdrawn");
  });
});
