import { describe, expect, it } from "vitest";

import { LIVE_SCORE_TTL_MS, signLiveScoreToken, verifyLiveScoreToken } from "./live-score-token";
import { signWidgetToken, verifyWidgetToken } from "./widget-token";

const SECRET = "test-secret";
const MEMBER = "00000000-0000-0000-0000-000000000001";
const NOW = 1_790_000_000_000;

describe("lock screen score keys", () => {
  it("round-trips the member and the round", () => {
    const { token, expiresAt } = signLiveScoreToken(MEMBER, 42, NOW, SECRET);
    expect(expiresAt).toBe(NOW + LIVE_SCORE_TTL_MS);
    expect(verifyLiveScoreToken(token, NOW + 1000, SECRET)).toEqual({ memberId: MEMBER, roundId: 42 });
  });

  it("expires after a round, not half a year", () => {
    const { token } = signLiveScoreToken(MEMBER, 42, NOW, SECRET);
    expect(verifyLiveScoreToken(token, NOW + LIVE_SCORE_TTL_MS + 1, SECRET)).toBeNull();
    expect(LIVE_SCORE_TTL_MS).toBeLessThanOrEqual(24 * 3600 * 1000);
  });

  it("refuses a tampered, foreign or malformed key", () => {
    const { token } = signLiveScoreToken(MEMBER, 42, NOW, SECRET);
    const [payload, sig] = token.split(".");
    const otherRound = Buffer.from(JSON.stringify({ v: 1, m: MEMBER, r: 43, exp: NOW + 1e6 })).toString("base64url");
    expect(verifyLiveScoreToken(`${otherRound}.${sig}`, NOW, SECRET)).toBeNull();
    expect(verifyLiveScoreToken(token, NOW, "another-secret")).toBeNull();
    expect(verifyLiveScoreToken(`${payload}.${sig}.x`, NOW, SECRET)).toBeNull();
    expect(verifyLiveScoreToken("", NOW, SECRET)).toBeNull();
    expect(verifyLiveScoreToken(undefined, NOW, SECRET)).toBeNull();
  });

  it("is not interchangeable with the widget's read-only key", () => {
    const widget = signWidgetToken(MEMBER, NOW, SECRET).token;
    expect(verifyLiveScoreToken(widget, NOW, SECRET)).toBeNull();
    const score = signLiveScoreToken(MEMBER, 42, NOW, SECRET).token;
    expect(verifyWidgetToken(score, NOW, SECRET)).toBeNull();
  });
});
