import { afterEach, describe, expect, it, vi } from "vitest";

import { chooseProvider, currentMapTiles, parseSession, resetMapTilesCache } from "./map-tiles";

const NOW = Date.UTC(2026, 9, 11, 9, 0, 0);
const DAY = 24 * 60 * 60 * 1000;
const sessionBody = (expiresInMs: number, token = "SESSION1") => ({
  session: token,
  expiry: String(Math.floor((NOW + expiresInMs) / 1000)),
  tileWidth: 512,
  tileHeight: 512,
  imageFormat: "jpeg",
});
const okFetch = (body: unknown) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;

afterEach(() => resetMapTilesCache());

describe("chooseProvider", () => {
  it("uses Google only when a key is set", () => {
    expect(chooseProvider({})).toBe("esri");
    expect(chooseProvider({ GOOGLE_MAP_TILES_KEY: "  " })).toBe("esri");
    expect(chooseProvider({ GOOGLE_MAP_TILES_KEY: "k" })).toBe("google");
  });
  it("has an off switch", () => {
    expect(chooseProvider({ GOOGLE_MAP_TILES_KEY: "k", MAP_TILES_PROVIDER: "Esri" })).toBe("esri");
  });
});

describe("parseSession", () => {
  it("reads Google's expiry in seconds", () => {
    expect(parseSession(sessionBody(14 * DAY), NOW)).toEqual({ token: "SESSION1", expiresAt: Math.floor((NOW + 14 * DAY) / 1000) * 1000 });
  });
  it("assumes two weeks when expiry is missing", () => {
    expect(parseSession({ session: "S" }, NOW)?.expiresAt).toBe(NOW + 14 * DAY);
  });
  it("rejects nothing-like-a-session and nearly-expired ones", () => {
    expect(parseSession({}, NOW)).toBeNull();
    expect(parseSession(null, NOW)).toBeNull();
    expect(parseSession(sessionBody(DAY / 2), NOW)).toBeNull();
  });
});

describe("currentMapTiles", () => {
  it("is Esri with no key, without calling Google", async () => {
    const f = okFetch(sessionBody(14 * DAY));
    expect(await currentMapTiles({}, f, NOW)).toEqual({ provider: "esri" });
    expect(f).not.toHaveBeenCalled();
  });

  it("creates a satellite session and builds z/x/y tile and viewport URLs", async () => {
    const f = okFetch(sessionBody(14 * DAY));
    const t = await currentMapTiles({ GOOGLE_MAP_TILES_KEY: "SERVERKEY" }, f, NOW);
    expect(t.provider).toBe("google");
    if (t.provider !== "google") return;
    expect(t.tileUrl).toBe("https://tile.googleapis.com/v1/2dtiles/{z}/{x}/{y}?session=SESSION1&key=SERVERKEY");
    expect(t.viewportUrl).toBe("https://tile.googleapis.com/tile/v1/viewport?session=SESSION1&key=SERVERKEY");
    expect(t.expiresAt).toBeLessThan(NOW + 14 * DAY);
    const [url, init] = (f as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0];
    expect(url).toBe("https://tile.googleapis.com/v1/createSession?key=SERVERKEY");
    expect(JSON.parse(String(init.body))).toMatchObject({ mapType: "satellite", region: "IE", highDpi: true });
  });

  it("puts the browser key in tile URLs when there is one", async () => {
    const t = await currentMapTiles({ GOOGLE_MAP_TILES_KEY: "SERVERKEY", GOOGLE_MAP_TILES_BROWSER_KEY: "APPKEY" }, okFetch(sessionBody(14 * DAY)), NOW);
    expect(t.provider === "google" && t.tileUrl.endsWith("key=APPKEY")).toBe(true);
  });

  it("reuses one session for everyone until a day before it expires", async () => {
    const f = okFetch(sessionBody(14 * DAY));
    const env = { GOOGLE_MAP_TILES_KEY: "k" };
    await currentMapTiles(env, f, NOW);
    await currentMapTiles(env, f, NOW + 5 * DAY);
    expect(f).toHaveBeenCalledTimes(1);
    await currentMapTiles(env, f, NOW + 13.5 * DAY);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("retries without the high-DPI options when Google answers 400", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const f = vi
      .fn()
      .mockResolvedValueOnce(new Response('{"error":{"code":400}}', { status: 400 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(sessionBody(14 * DAY, "PLAIN")), { status: 200 })) as unknown as typeof fetch;
    const t = await currentMapTiles({ GOOGLE_MAP_TILES_KEY: "k" }, f, NOW);
    expect(t.provider === "google" && t.tileUrl.includes("session=PLAIN")).toBe(true);
    const bodies = (f as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls.map((c) => JSON.parse(String(c[1].body)));
    expect(bodies[0].highDpi).toBe(true);
    expect(bodies[1]).toEqual({ mapType: "satellite", language: "en-GB", region: "IE" });
    errors.mockRestore();
  });

  it("doesn't retry a refusal the plainer ask can't fix", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const f = vi.fn(async () => new Response("forbidden", { status: 403 })) as unknown as typeof fetch;
    expect(await currentMapTiles({ GOOGLE_MAP_TILES_KEY: "k" }, f, NOW)).toEqual({ provider: "esri" });
    expect(f).toHaveBeenCalledTimes(1);
    errors.mockRestore();
  });

  it("falls back to Esri when Google refuses or can't be reached", async () => {
    const refused = vi.fn(async () => new Response("API key not valid", { status: 403 })) as unknown as typeof fetch;
    const broken = vi.fn(async () => {
      throw new Error("network");
    }) as unknown as typeof fetch;
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await currentMapTiles({ GOOGLE_MAP_TILES_KEY: "k" }, refused, NOW)).toEqual({ provider: "esri" });
    expect(await currentMapTiles({ GOOGLE_MAP_TILES_KEY: "k" }, broken, NOW)).toEqual({ provider: "esri" });
    errors.mockRestore();
  });
});
