import { describe, expect, it } from "vitest";
import { rateLimitMessage } from "./rate-limit";

describe("rateLimitMessage", () => {
  it("says 'a minute' for anything at or under 60 seconds", () => {
    expect(rateLimitMessage(1)).toBe("Too many attempts — please wait a minute and try again.");
    expect(rateLimitMessage(60)).toBe("Too many attempts — please wait a minute and try again.");
  });

  it("rounds up to whole minutes for longer waits", () => {
    expect(rateLimitMessage(61)).toBe("Too many attempts — please wait 2 minutes and try again.");
    expect(rateLimitMessage(300)).toBe("Too many attempts — please wait 5 minutes and try again.");
  });
});
