import { describe, expect, it, vi } from "vitest";

// feed-operations pulls in server clients at import; none are used here.
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/notifications-server", () => ({ notifyUser: async () => undefined }));

const { parseMentions } = await import("./feed-operations");

const A = "00000000-0000-0000-0000-000000000001";
const B = "00000000-0000-0000-0000-000000000002";

describe("parseMentions", () => {
  it("absent is none", () => {
    expect(parseMentions(undefined)).toEqual([]);
    expect(parseMentions(null)).toEqual([]);
  });
  it("keeps distinct member ids", () => {
    expect(parseMentions([A, B, A])).toEqual([A, B]);
  });
  it("refuses anything that isn't a short list of ids", () => {
    expect(parseMentions("A")).toBeNull();
    expect(parseMentions([A, 7])).toBeNull();
    expect(parseMentions(["not-a-uuid"])).toBeNull();
    expect(parseMentions(Array.from({ length: 11 }, () => A))).toBeNull();
  });
});
