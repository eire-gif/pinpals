import { describe, it, expect } from "vitest";
import { isDue, hasTimeFor, externalIdFor, externalIdForUrl, sha256 } from "./collect";

describe("isDue", () => {
  const now = new Date("2026-09-10T12:00:00Z");

  it("is due when it has never been fetched", () => {
    expect(isDue({ last_fetched_at: null, poll_interval_minutes: 360 }, now)).toBe(true);
  });

  it("is not due inside the interval", () => {
    expect(
      isDue({ last_fetched_at: "2026-09-10T11:00:00Z", poll_interval_minutes: 360 }, now),
    ).toBe(false);
  });

  it("is due once the interval has elapsed", () => {
    expect(
      isDue({ last_fetched_at: "2026-09-10T05:59:00Z", poll_interval_minutes: 360 }, now),
    ).toBe(true);
  });

  it("is due exactly on the boundary", () => {
    expect(
      isDue({ last_fetched_at: "2026-09-10T06:00:00Z", poll_interval_minutes: 360 }, now),
    ).toBe(true);
  });
});

describe("externalIdFor", () => {
  const base = { title: "T", link: "https://x.com/a", publishedAt: null, body: "" };

  it("prefers the feed's own guid", () => {
    expect(externalIdFor({ ...base, externalId: "guid-123" })).toBe("guid-123");
  });

  it("falls back to the link when there is no guid", () => {
    expect(externalIdFor({ ...base, externalId: "" })).toBe("https://x.com/a");
  });

  it("hashes an id too long for the column", () => {
    const long = "https://x.com/" + "a".repeat(300);
    const id = externalIdFor({ ...base, externalId: long });
    expect(id).toHaveLength(64);
    expect(id).toBe(sha256(long));
  });

  it("is stable across calls, so a re-poll dedupes", () => {
    const item = { ...base, externalId: "" , link: "https://x.com/release/1" };
    expect(externalIdFor(item)).toBe(externalIdFor({ ...item }));
  });
});

describe("hasTimeFor", () => {
  // The route is capped at 60 seconds and pg_cron gives up at 55, so a run
  // budgets 45 and keeps 8 in reserve to write down what it collected.
  const now = 1_000_000;
  const deadline = now + 45_000;

  it("allows another ten-second gap early in the run", () => {
    expect(hasTimeFor(deadline, 10_000, now)).toBe(true);
  });

  it("refuses one that would not leave room to save the results", () => {
    // 30s gone, 15s left: a 10s wait plus 8s of reserve does not fit.
    expect(hasTimeFor(deadline, 10_000, now + 30_000)).toBe(false);
  });

  it("still allows work that needs nothing but the reserve", () => {
    expect(hasTimeFor(deadline, 0, now + 30_000)).toBe(true);
  });

  it("refuses everything once the deadline has passed", () => {
    expect(hasTimeFor(deadline, 0, deadline + 1)).toBe(false);
    expect(hasTimeFor(deadline, 10_000, deadline + 60_000)).toBe(false);
  });

  it("treats the exact boundary as usable rather than rounding it away", () => {
    // Precisely enough for the work plus the reserve.
    expect(hasTimeFor(deadline, 10_000, deadline - 18_000)).toBe(true);
    expect(hasTimeFor(deadline, 10_000, deadline - 17_999)).toBe(false);
  });
});

describe("externalIdForUrl", () => {
  it("uses the URL itself, so dedupe survives a re-read of the sitemap", () => {
    const url = "https://www.rydercup.com/news-media/harrington-vice-captain";
    expect(externalIdForUrl(url)).toBe(url);
    expect(externalIdForUrl(url)).toBe(externalIdForUrl(url));
  });

  it("hashes a URL too long for the column", () => {
    const long = `https://www.europeantour.com/dpworld-tour/news/articles/detail/${"x".repeat(220)}/`;
    expect(externalIdForUrl(long)).toHaveLength(64);
  });

  it("distinguishes two articles that differ only in their slug", () => {
    expect(externalIdForUrl("https://a.com/news/one")).not.toBe(
      externalIdForUrl("https://a.com/news/two"),
    );
  });
});

describe("sha256", () => {
  it("changes when the source edits a release", () => {
    expect(sha256("Original release text")).not.toBe(sha256("Original release text."));
  });

  it("is stable for identical text", () => {
    expect(sha256("same")).toBe(sha256("same"));
    expect(sha256("same")).toHaveLength(64);
  });
});
