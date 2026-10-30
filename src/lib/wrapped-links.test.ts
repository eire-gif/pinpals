import { describe, expect, it } from "vitest";

import { signScorecardToken } from "./scorecard-links";
import { signWrappedToken, verifyWrappedToken } from "./wrapped-links";

const SECRET = "test-secret-test-secret-test-secret";
const ME = "00000000-0000-0000-0000-000000000001";

describe("wrapped links", () => {
  it("round-trips a member and year", () => {
    expect(verifyWrappedToken(signWrappedToken(ME, 2026, SECRET), SECRET)).toEqual({ m: ME, y: 2026, v: 1 });
  });
  it("refuses a tampered, foreign or other-secret token", () => {
    const t = signWrappedToken(ME, 2026, SECRET);
    const [p, s] = t.split(".");
    const other = Buffer.from(JSON.stringify({ m: ME, y: 2025, v: 1 })).toString("base64url");
    expect(verifyWrappedToken(`${other}.${s}`, SECRET)).toBeNull();
    expect(verifyWrappedToken(`${p}.${s}x`, SECRET)).toBeNull();
    expect(verifyWrappedToken(t, "another-secret-another-secret-xx")).toBeNull();
    expect(verifyWrappedToken(signScorecardToken(5, ME, SECRET), SECRET)).toBeNull();
    expect(verifyWrappedToken("nonsense", SECRET)).toBeNull();
  });
});
