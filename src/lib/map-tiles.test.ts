import { createVerify, generateKeyPairSync } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

import { chooseProvider, currentMapTiles, mapKitToken, parseSession, resetMapTilesCache } from "./map-tiles";

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

const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const PEM = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const APPLE = { MAPKIT_TEAM_ID: "TEAM123456", MAPKIT_KEY_ID: "KEY7654321", MAPKIT_PRIVATE_KEY: PEM.replace(/\n/g, "\\n") };

describe("chooseProvider with Apple", () => {
  it("prefers Apple once its three settings are in, over a Google key", () => {
    expect(chooseProvider({ ...APPLE, GOOGLE_MAP_TILES_KEY: "k" })).toBe("apple");
    expect(chooseProvider({ MAPKIT_KEY_ID: "x", MAPKIT_PRIVATE_KEY: "y", GOOGLE_MAP_TILES_KEY: "k" })).toBe("google");
  });
  it("takes the team from the WeatherKit setting", () => {
    expect(chooseProvider({ MAPKIT_KEY_ID: "x", MAPKIT_PRIVATE_KEY: "y", WEATHERKIT_TEAM_ID: "T" })).toBe("apple");
  });
  it("can be forced either way, and esri is always the off switch", () => {
    expect(chooseProvider({ ...APPLE, GOOGLE_MAP_TILES_KEY: "k", MAP_TILES_PROVIDER: "google" })).toBe("google");
    expect(chooseProvider({ ...APPLE, MAP_TILES_PROVIDER: "esri" })).toBe("esri");
    expect(chooseProvider({ MAP_TILES_PROVIDER: "apple" })).toBe("esri");
  });
});

describe("mapKitToken", () => {
  it("is an ES256 JWT MapKit JS accepts: kid and typ, iss = team, a day long", () => {
    const t = mapKitToken(APPLE, 1_800_000_000);
    const [h, b, sig] = t.split(".");
    expect(JSON.parse(Buffer.from(h, "base64url").toString())).toEqual({ alg: "ES256", kid: "KEY7654321", typ: "JWT" });
    expect(JSON.parse(Buffer.from(b, "base64url").toString())).toEqual({ iss: "TEAM123456", iat: 1_800_000_000, exp: 1_800_086_400 });
    const v = createVerify("SHA256");
    v.update(`${h}.${b}`);
    expect(v.verify({ key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(sig, "base64url"))).toBe(true);
  });
});

describe("currentMapTiles with Apple", () => {
  it("hands out one token, re-signed when half its day is gone, without calling Google", async () => {
    const f = okFetch(sessionBody(14 * DAY));
    const a = await currentMapTiles({ ...APPLE, GOOGLE_MAP_TILES_KEY: "k" }, f, NOW);
    expect(a.provider).toBe("apple");
    if (a.provider !== "apple") return;
    expect(a.expiresAt).toBe(Math.floor(NOW / 1000) * 1000 + DAY / 2);
    const b = await currentMapTiles(APPLE, f, NOW + 2 * 3600_000);
    expect(b.provider === "apple" && b.token).toBe(a.token);
    const c = await currentMapTiles(APPLE, f, NOW + 13 * 3600_000);
    expect(c.provider === "apple" && c.token).not.toBe(a.token);
    expect(f).not.toHaveBeenCalled();
  });
  it("falls back to Esri when the key won't sign", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await currentMapTiles({ ...APPLE, MAPKIT_PRIVATE_KEY: "not a key" }, okFetch({}), NOW)).toEqual({ provider: "esri" });
    errors.mockRestore();
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
