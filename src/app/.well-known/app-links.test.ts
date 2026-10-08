import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { GET as appleAssociation } from "./apple-app-site-association/route";
import { GET as assetLinks } from "./assetlinks.json/route";

/**
 * Android's app-link paths (mobile/app.json intentFilters) and Apple's
 * (apple-app-site-association) are two lists that must agree. Android can't
 * exclude, so it claims a subset; this keeps it a subset, and keeps the
 * paths that must finish on the website off it.
 */

type AndroidData = { scheme?: string; host?: string; path?: string; pathPrefix?: string };

const appJson = JSON.parse(readFileSync(path.resolve(__dirname, "../../../mobile/app.json"), "utf8"));
const filters: { data: AndroidData[] }[] = appJson.expo.android.intentFilters;
const androidPaths = filters.flatMap((f) => f.data).filter((d) => d.path || d.pathPrefix);

function androidClaims(p: string): boolean {
  return androidPaths.some((d) => (d.path ? d.path === p : p.startsWith(d.pathPrefix!)));
}

async function appleIncludes(): Promise<RegExp[]> {
  const body = await appleAssociation().json();
  const components: { "/": string; exclude?: boolean }[] = body.applinks.details[0].components;
  return components
    .filter((c) => !c.exclude)
    .map((c) => new RegExp(`^${c["/"].replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`));
}

describe("Android app links", () => {
  it("claim only what iOS claims", async () => {
    const apple = await appleIncludes();
    for (const d of androidPaths) {
      // A prefix like "/feed/" is checked with a sample path under it.
      const sample = d.path ?? `${d.pathPrefix}x`;
      expect(apple.some((re) => re.test(sample)), `${sample} is not claimed on iOS`).toBe(true);
    }
  });

  it("never take paths that must finish on the website", () => {
    for (const p of [
      "/auth/app-session",
      "/dashboard/payouts/return",
      "/dashboard/orders/88",
      "/courses/portmarnock",
      "/news",
      "/admin",
    ]) {
      expect(androidClaims(p), p).toBe(false);
    }
  });

  it("only for www.pinpals.ie over https", () => {
    const hosts = filters.flatMap((f) => f.data).filter((d) => d.host || d.scheme);
    expect(hosts).toEqual([{ scheme: "https", host: "www.pinpals.ie" }]);
  });

  it("assetlinks.json is valid JSON naming the app when it lists anything", async () => {
    const res = assetLinks();
    expect(res.headers.get("content-type")).toBe("application/json");
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    for (const entry of body) {
      expect(entry.target.package_name).toBe("ie.pinpals.app");
      for (const fp of entry.target.sha256_cert_fingerprints) {
        expect(fp).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
      }
    }
  });
});
