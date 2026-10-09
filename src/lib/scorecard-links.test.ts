import { describe, expect, it } from "vitest";

import { signScorecardToken, verifyScorecardToken } from "./scorecard-links";
import { signShareToken, verifyShareToken } from "./share-links";

const SECRET = "test-secret";

describe("scorecard share tokens", () => {
  it("round-trips", () => {
    const t = signScorecardToken(42, "member-1", SECRET);
    expect(verifyScorecardToken(t, SECRET)).toEqual({ c: 42, s: "member-1", v: 1 });
  });

  it("refuses a tampered token or the wrong secret", () => {
    const t = signScorecardToken(42, "member-1", SECRET);
    const [p, s] = t.split(".");
    const forged = Buffer.from(JSON.stringify({ c: 43, s: "member-1", v: 1 })).toString("base64url");
    expect(verifyScorecardToken(`${forged}.${s}`, SECRET)).toBeNull();
    expect(verifyScorecardToken(`${p}.${s}`, "other")).toBeNull();
    expect(verifyScorecardToken("nonsense", SECRET)).toBeNull();
  });

  it("can't be swapped with a post share token", () => {
    expect(verifyScorecardToken(signShareToken(42, "member-1", SECRET), SECRET)).toBeNull();
    expect(verifyShareToken(signScorecardToken(42, "member-1", SECRET), SECRET)).toBeNull();
  });
});
