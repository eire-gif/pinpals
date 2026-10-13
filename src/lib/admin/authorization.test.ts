import { beforeEach, describe, expect, it, vi } from "vitest";

// --- Mocks -----------------------------------------------------------------
// authorization.ts talks to two things we don't want a real network/DB or a
// real Next.js request for: the Supabase server client, and Next's
// redirect()/notFound(). Both are mocked so these tests exercise only the
// authorization decision logic in authorization.ts + roles.ts.

const mockGetUser = vi.fn();
const mockMaybeSingle = vi.fn();
const mockGetAal = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: mockGetUser,
      mfa: { getAuthenticatorAssuranceLevel: mockGetAal },
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: mockMaybeSingle,
        }),
      }),
    }),
  })),
}));

class RedirectSignal extends Error {
  constructor(url: string) {
    super(`REDIRECT:${url}`);
  }
}
class NotFoundSignal extends Error {
  constructor() {
    super("NOT_FOUND");
  }
}

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new RedirectSignal(url);
  }),
  notFound: vi.fn(() => {
    throw new NotFoundSignal();
  }),
}));

const { requireStaff } = await import("./authorization");

function mockUser(id = "u1", email = "staff@pinpals.ie") {
  mockGetUser.mockResolvedValue({ data: { user: { id, email } } });
}

describe("requireStaff", () => {
  beforeEach(() => {
    mockGetUser.mockReset();
    mockMaybeSingle.mockReset();
    mockGetAal.mockReset();
    // Two-step sign-in done, unless a test says otherwise.
    mockGetAal.mockResolvedValue({ data: { currentLevel: "aal2" }, error: null });
  });

  it("redirects an unauthenticated request to /login", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    await expect(requireStaff()).rejects.toThrow("REDIRECT:/login?next=/admin");
  });

  it("404s an ordinary authenticated user with no staff_roles row", async () => {
    mockUser();
    mockMaybeSingle.mockResolvedValue({ data: null });
    await expect(requireStaff()).rejects.toThrow("NOT_FOUND");
  });

  it("404s a disabled admin", async () => {
    mockUser();
    mockMaybeSingle.mockResolvedValue({
      data: { user_id: "u1", role: "admin", status: "disabled" },
    });
    await expect(requireStaff()).rejects.toThrow("NOT_FOUND");
  });

  it("404s an active staff member whose role isn't in the allowed list", async () => {
    mockUser();
    mockMaybeSingle.mockResolvedValue({
      data: { user_id: "u1", role: "support", status: "active" },
    });
    await expect(requireStaff({ roles: ["finance", "admin"] })).rejects.toThrow("NOT_FOUND");
  });

  it("allows an active staff member with an allowed role and returns the session", async () => {
    mockUser("u1", "admin@pinpals.ie");
    mockMaybeSingle.mockResolvedValue({
      data: { user_id: "u1", role: "admin", status: "active" },
    });
    const result = await requireStaff({ roles: ["admin", "super_admin"] });
    expect(result.user.email).toBe("admin@pinpals.ie");
    expect(result.staff.role).toBe("admin");
  });

  it("allows any active staff role when no roles filter is given", async () => {
    mockUser();
    mockMaybeSingle.mockResolvedValue({
      data: { user_id: "u1", role: "support", status: "active" },
    });
    const result = await requireStaff();
    expect(result.staff.role).toBe("support");
  });

  it("sends staff without two-step sign-in to /two-step, by default", async () => {
    mockUser();
    mockMaybeSingle.mockResolvedValue({
      data: { user_id: "u1", role: "super_admin", status: "active" },
    });
    mockGetAal.mockResolvedValue({ data: { currentLevel: "aal1" }, error: null });
    await expect(requireStaff()).rejects.toThrow("REDIRECT:/two-step");
    await expect(requireStaff({ requiredAal: "aal2" })).rejects.toThrow("REDIRECT:/two-step");
  });

  it("still 404s a member on a password-only session — the redirect is for staff only", async () => {
    mockUser();
    mockMaybeSingle.mockResolvedValue({ data: null });
    mockGetAal.mockResolvedValue({ data: { currentLevel: "aal1" }, error: null });
    await expect(requireStaff()).rejects.toThrow("NOT_FOUND");
  });

  it("lets a caller opt out with requiredAal aal1 (the two-step page itself)", async () => {
    mockUser();
    mockMaybeSingle.mockResolvedValue({
      data: { user_id: "u1", role: "support", status: "active" },
    });
    mockGetAal.mockResolvedValue({ data: { currentLevel: "aal1" }, error: null });
    const result = await requireStaff({ requiredAal: "aal1" });
    expect(result.staff.role).toBe("support");
  });

  it("allows when requiredAal is aal2 and the session already satisfies it", async () => {
    mockUser();
    mockMaybeSingle.mockResolvedValue({
      data: { user_id: "u1", role: "super_admin", status: "active" },
    });
    mockGetAal.mockResolvedValue({ data: { currentLevel: "aal2" }, error: null });
    const result = await requireStaff({ requiredAal: "aal2" });
    expect(result.staff.role).toBe("super_admin");
  });
});
