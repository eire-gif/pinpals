import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn(async () => ({ allowed: true })),
  rateLimitMessage: () => "Too many attempts",
}));

import { blockMember, unblockMember } from "./blocking";
import { checkRateLimit } from "@/lib/rate-limit";

const ME = "11111111-1111-4111-8111-111111111111";
const THEM = "22222222-2222-4222-8222-222222222222";

function client(insertError: { code: string } | null = null) {
  const insert = vi.fn(async () => ({ error: insertError }));
  const eq2 = vi.fn(async () => ({ error: null }));
  const eq1 = vi.fn(() => ({ eq: eq2 }));
  const del = vi.fn(() => ({ eq: eq1 }));
  const from = vi.fn(() => ({ insert, delete: del }));
  return { supabase: { from } as unknown as SupabaseClient, insert, del, eq1, eq2 };
}

describe("blockMember", () => {
  it("inserts a block as the caller", async () => {
    const c = client();
    expect(await blockMember(c.supabase, ME, THEM)).toEqual({ ok: true });
    expect(c.insert).toHaveBeenCalledWith({ blocker_id: ME, blocked_id: THEM });
  });

  it("treats an existing block as success", async () => {
    expect(await blockMember(client({ code: "23505" }).supabase, ME, THEM)).toEqual({ ok: true });
  });

  it("refuses yourself and anything that is not a member id, before touching the database", async () => {
    const c = client();
    expect((await blockMember(c.supabase, ME, ME)).ok).toBe(false);
    expect((await blockMember(c.supabase, ME, "not-a-uuid")).ok).toBe(false);
    expect(c.insert).not.toHaveBeenCalled();
  });

  it("reports a member who does not exist", async () => {
    const r = await blockMember(client({ code: "23503" }).supabase, ME, THEM);
    expect(r).toMatchObject({ ok: false, reason: "not_found" });
  });

  it("is rate limited", async () => {
    vi.mocked(checkRateLimit).mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 60 });
    const c = client();
    expect(await blockMember(c.supabase, ME, THEM)).toMatchObject({ ok: false, reason: "rate_limited" });
    expect(c.insert).not.toHaveBeenCalled();
  });
});

describe("unblockMember", () => {
  it("deletes only the caller's own block", async () => {
    const c = client();
    expect(await unblockMember(c.supabase, ME, THEM)).toEqual({ ok: true });
    expect(c.eq1).toHaveBeenCalledWith("blocker_id", ME);
    expect(c.eq2).toHaveBeenCalledWith("blocked_id", THEM);
  });
});
