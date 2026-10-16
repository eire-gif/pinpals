import { describe, expect, it } from "vitest";

import { scorecardPhotoFilename, scorecardPhotoPath, signScorecardToken, verifyScorecardToken } from "./scorecard-links";
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

describe("scorecard photo", () => {
  it("lives under the card's own link", () => {
    expect(scorecardPhotoPath("abc.def")).toBe("/c/abc.def/photo");
  });

  it("names the file after the course and the day, in plain ASCII", () => {
    expect(scorecardPhotoFilename("Portmarnock Links", "2026-10-04")).toBe("pinpals-portmarnock-links-2026-10-04.png");
    expect(scorecardPhotoFilename("Ballybunion (Old Course)", "2026-09-30")).toBe("pinpals-ballybunion-old-course-2026-09-30.png");
    expect(scorecardPhotoFilename("Clár Chlainne Mhuiris", "2026-10-01")).toBe("pinpals-clar-chlainne-mhuiris-2026-10-01.png");
    expect(scorecardPhotoFilename("\"; rm -rf /", "nonsense")).toBe("pinpals-rm-rf.png");
    expect(scorecardPhotoFilename("★★★", "2026-10-01")).toBe("pinpals-scorecard-2026-10-01.png");
  });
});
