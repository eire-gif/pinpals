import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A member with a browser AND a phone registered: "app only" must reach the
// phone and never the browser (Oct 2026, live_highlight).
const webSend = vi.fn(async () => ({ statusCode: 201 }));
vi.mock("web-push", () => ({ default: { setVapidDetails: () => undefined, sendNotification: webSend } }));

const ROWS = [
  { id: 1, endpoint: "https://web.push.example/abc", p256dh: "k", auth: "a", failure_count: 0, platform: "web" },
  { id: 2, endpoint: "ExponentPushToken[phone]", p256dh: null, auth: null, failure_count: 0, platform: "ios" },
];

/** Any query resolves to the two devices; writes resolve to nothing. */
function fakeAdmin() {
  const chain: Record<string, unknown> = {};
  const result = { data: ROWS, error: null, count: 0 };
  for (const m of ["select", "eq", "in", "is", "returns", "update", "delete", "order", "limit", "neq", "gt", "lt"]) chain[m] = () => chain;
  chain.then = (resolve: (v: unknown) => unknown) => resolve(result);
  return { from: () => chain, rpc: async () => ({ data: 0, error: null }) } as never;
}

describe("app-only push", () => {
  const expoCalls: string[] = [];
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", "pub");
    vi.stubEnv("VAPID_PRIVATE_KEY", "priv");
    vi.stubEnv("VAPID_SUBJECT", "mailto:test@pinpals.ie");
    webSend.mockClear();
    expoCalls.length = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        expoCalls.push(String(init?.body ?? ""));
        return new Response(JSON.stringify({ data: [{ status: "ok", id: "t1" }] }), { status: 200, headers: { "content-type": "application/json" } });
      })
    );
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  const payload = { type: "live_highlight", title: "🐦 Birdie for Eire!", body: "3 on the 7th", href: "/live/rounds/1", dedupeKey: null } as never;

  it("normally goes to both the browser and the phone", async () => {
    const { sendPushToUser } = await import("@/lib/push-server");
    await sendPushToUser(fakeAdmin(), "u1", payload);
    expect(webSend).toHaveBeenCalledTimes(1);
    expect(expoCalls.join()).toContain("ExponentPushToken[phone]");
  });

  it("with appOnly, only the phone", async () => {
    const { sendPushToUser } = await import("@/lib/push-server");
    await sendPushToUser(fakeAdmin(), "u1", payload, { appOnly: true });
    expect(webSend).not.toHaveBeenCalled();
    expect(expoCalls.join()).toContain("ExponentPushToken[phone]");
  });
});
