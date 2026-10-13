import { describe, expect, it } from "vitest";

import { signScorecardToken } from "./scorecard-links";
import { signTeeTimeToken, verifyTeeTimeToken } from "./tee-time-links";

const SECRET = "test-secret";
const SHARER = "11111111-1111-1111-1111-111111111111";

describe("tee time links", () => {
  it("round-trips a signed token", () => {
    const token = signTeeTimeToken(42, SHARER, SECRET);
    expect(verifyTeeTimeToken(token, SECRET)).toEqual({ t: 42, s: SHARER, v: 1 });
  });

  it("rejects a changed payload, a wrong secret and junk", () => {
    const token = signTeeTimeToken(42, SHARER, SECRET);
    const [, sig] = token.split(".");
    const forged = `${Buffer.from(JSON.stringify({ t: 43, s: SHARER, v: 1 })).toString("base64url")}.${sig}`;
    expect(verifyTeeTimeToken(forged, SECRET)).toBeNull();
    expect(verifyTeeTimeToken(token, "other")).toBeNull();
    expect(verifyTeeTimeToken("nope", SECRET)).toBeNull();
  });

  it("never accepts a scorecard token, even under the same secret", () => {
    expect(verifyTeeTimeToken(signScorecardToken(42, SHARER, SECRET), SECRET)).toBeNull();
  });
});
