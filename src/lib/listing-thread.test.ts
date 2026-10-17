import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildThread, offerLine, parseEuroInput, shortAgo, type ThreadPostRow } from "./listing-thread";

const row = (over: Partial<ThreadPostRow>): ThreadPostRow => ({
  id: 1,
  kind: "question",
  parent_id: null,
  author_name: "Aoife B.",
  author_initials: "AB",
  author_color: "#7a4b1c",
  author_club: "Malahide",
  is_seller: false,
  is_mine: false,
  body: "Clean face?",
  amount_cents: null,
  status: null,
  counter_cents: null,
  created_at: "2026-10-17T10:00:00Z",
  ...over,
});

describe("listing-thread.ts", () => {
  it("is byte-identical in the website and the app", () => {
    const site = readFileSync(join(process.cwd(), "src/lib/listing-thread.ts"), "utf8");
    const app = readFileSync(join(process.cwd(), "mobile/src/lib/listing-thread.ts"), "utf8");
    expect(app).toBe(site);
  });
});

describe("buildThread", () => {
  const rows = [
    row({ id: 1, created_at: "2026-10-17T09:00:00Z" }),
    row({ id: 2, kind: "offer", body: null, amount_cents: 20000, status: "countered", counter_cents: 23500, created_at: "2026-10-17T10:00:00Z" }),
    row({ id: 3, kind: "reply", parent_id: 1, is_seller: true, body: "No marks", created_at: "2026-10-17T11:00:00Z" }),
    row({ id: 4, kind: "offer", body: null, amount_cents: 23000, status: "open", created_at: "2026-10-17T12:00:00Z" }),
    row({ id: 5, kind: "offer", body: null, amount_cents: 26000, status: "declined", created_at: "2026-10-17T13:00:00Z" }),
  ];
  const t = buildThread(rows);

  it("puts the newest first and replies under what they answer", () => {
    expect(t.entries.map((e) => e.id)).toEqual([5, 4, 2, 1]);
    expect(t.entries[3].replies.map((r) => r.body)).toEqual(["No marks"]);
  });

  it("counts, and the highest live offer ignores declined ones", () => {
    expect(t).toMatchObject({ questions: 1, offers: 3, openOffers: 1, highestOpenCents: 23000, total: 5 });
  });

  it("words a counter offer", () => {
    expect(offerLine(t.entries.find((e) => e.id === 2)!)).toBe("€200 offered · seller would take €235");
  });

  it("is empty for no rows", () => {
    expect(buildThread([])).toMatchObject({ entries: [], highestOpenCents: null, total: 0 });
  });
});

describe("parseEuroInput", () => {
  it("reads what people type", () => {
    expect(parseEuroInput("235")).toBe(23500);
    expect(parseEuroInput("€ 1,200")).toBe(120000);
    expect(parseEuroInput("99.5")).toBe(9950);
    expect(parseEuroInput("0.50")).toBeNull();
    expect(parseEuroInput("abc")).toBeNull();
  });
});

describe("shortAgo", () => {
  it("is short", () => {
    const now = new Date("2026-10-17T12:00:00Z");
    expect(shortAgo("2026-10-17T11:58:00Z", now)).toBe("2m");
    expect(shortAgo("2026-10-17T09:00:00Z", now)).toBe("3h");
    expect(shortAgo("2026-10-15T12:00:00Z", now)).toBe("2d");
  });
});
