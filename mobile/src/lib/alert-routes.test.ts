import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { appRouteFor } from "./alert-routes";

/**
 * Every href the codebase can actually put on a notification is exercised
 * here, taken from the call sites rather than invented: src/lib/
 * tee-times-server.ts, src/lib/stripe/payments.ts, src/lib/orders.ts,
 * src/lib/messaging-server.ts, and the jsonb_build_object('href', ...) calls
 * in 0056_marketplace_notifications_reviews.sql.
 *
 * The point of the file is the pairs that are easy to get backwards —
 * interested/requests, order/checkout — and the ones that must NOT match a
 * pattern they look like they should.
 */

describe("appRouteFor", () => {
  it("sends a message alert to the native thread", () => {
    expect(appRouteFor("/conversations/412")).toEqual({
      kind: "native",
      path: "/conversation/412",
    });
  });

  it("sends a marketplace alert to the native listing", () => {
    // offer_received, offer_declined, outbid, auction_won — every one of
    // these carries /marketplace/<listing id>.
    expect(appRouteFor("/marketplace/88")).toEqual({
      kind: "native",
      path: "/listing/88",
    });
  });

  it("keeps the two tee-time sides the right way round", () => {
    // The host is told someone wants in; the applicant is told about their
    // own request. Swapping these shows each of them the other's screen,
    // which is empty, which reads as the alert being wrong.
    expect(appRouteFor("/tee-times/interested")).toEqual({
      kind: "native",
      path: "/tee-time-requests",
    });
    expect(appRouteFor("/tee-times/requests")).toEqual({
      kind: "native",
      path: "/my-requests",
    });
  });

  it("does not read a named tee-time page as a tee-time id", () => {
    // /^\/tee-times\/(\d+)$/ must not be reached for these. \d+ is what
    // stops it, and this is the test that says so.
    for (const path of ["/tee-times/interested", "/tee-times/requests", "/tee-times/confirmed"]) {
      expect(appRouteFor(path).path.startsWith("/invite/")).toBe(false);
    }
  });

  it("sends a confirmed-place alert to confirmed rounds", () => {
    expect(appRouteFor("/tee-times/confirmed")).toEqual({
      kind: "native",
      path: "/confirmed-rounds",
    });
  });

  it("lands both the order page and its checkout on the order screen", () => {
    expect(appRouteFor("/dashboard/orders/5")).toEqual({
      kind: "native",
      path: "/order/5",
    });
    expect(appRouteFor("/dashboard/orders/5/checkout")).toEqual({
      kind: "native",
      path: "/order/5",
    });
  });

  it("does not treat the orders index as an order", () => {
    expect(appRouteFor("/dashboard/orders")).toEqual({
      kind: "native",
      path: "/buying",
    });
  });

  it("drops a query that the native screen has no use for", () => {
    // notifyDeliveryUpdate sends these two. Neither app screen has tabs, so
    // the tab is lost — but the screen is still the right screen.
    expect(appRouteFor("/dashboard/buying?tab=delivery")).toEqual({
      kind: "native",
      path: "/buying",
    });
    expect(appRouteFor("/dashboard/selling?tab=sales")).toEqual({
      kind: "native",
      path: "/selling",
    });
  });

  it("treats a trailing slash as the same path", () => {
    expect(appRouteFor("/dashboard/payouts/")).toEqual({
      kind: "native",
      path: "/payouts",
    });
  });

  it("opens the app's own settings, tee times and profile editor", () => {
    expect(appRouteFor("/dashboard/notifications")).toMatchObject({ kind: "native" });
    expect(appRouteFor("/dashboard/availability")).toMatchObject({ kind: "native" });
    expect(appRouteFor("/profile/edit")).toMatchObject({ kind: "native" });
  });

  it("falls back to the web view for a page the app doesn't have", () => {
    // notificationHref()'s own default.
    expect(appRouteFor("/news/some-article")).toEqual({
      kind: "web",
      path: "/news/some-article",
    });
  });

  it("keeps the query on a web fallback, where it still means something", () => {
    expect(appRouteFor("/news?tag=ryder-cup")).toEqual({
      kind: "web",
      path: "/news?tag=ryder-cup",
    });
  });

  it("sends the bare dashboard home", () => {
    expect(appRouteFor("/dashboard")).toEqual({ kind: "native", path: "/" });
  });

  it("refuses anything that isn't one of our own paths", () => {
    // notificationHref() on the server already refuses to store these. This
    // is the second floor, and it must not open a web view pointed at
    // somebody else's site.
    for (const href of [
      "https://evil.example.com",
      "//evil.example.com/x",
      "relative/path",
      "",
    ]) {
      expect(appRouteFor(href)).toEqual({ kind: "native", path: "/" });
    }
  });

  it("refuses a non-string href without throwing", () => {
    // Rows come from the database and `data` is jsonb — a malformed one is a
    // bad row, not a reason for the inbox to crash.
    expect(appRouteFor(undefined as unknown as string)).toEqual({
      kind: "native",
      path: "/",
    });
  });
});

/**
 * The table above says `/tee-times/interested` opens `/tee-time-requests`.
 * Nothing in it knows whether that screen exists.
 *
 * expo-router resolves routes from the filesystem at runtime, so a path that
 * does not correspond to a file does not fail to compile and does not throw —
 * it navigates to a blank screen. Renaming my-requests.tsx would break this
 * mapping and break nothing else, which is precisely the kind of thing that
 * survives to production.
 *
 * So this reads the app directory and checks every native destination the
 * table can produce against what is actually there.
 */
const APP_DIR = path.resolve(__dirname, "../app");

/** Every route expo-router would serve, as a path — "(tabs)" and "index"
 *  removed the way the router removes them, and "[id]" left in place so a
 *  dynamic route can be matched by shape. */
function routesOn(dir: string, prefix = ""): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      // A group — "(tabs)" — is organisation, not a path segment.
      const segment = entry.startsWith("(") && entry.endsWith(")") ? "" : `/${entry}`;
      out.push(...routesOn(full, prefix + segment));
      continue;
    }
    if (!entry.endsWith(".tsx") || entry.startsWith("_")) continue;
    const name = entry.replace(/\.tsx$/, "");
    out.push(name === "index" ? prefix || "/" : `${prefix}/${name}`);
  }
  return out;
}

describe("every native destination is a screen that exists", () => {
  const routes = new Set(routesOn(APP_DIR));

  /** Numeric ids stand in for the dynamic segment the route file declares. */
  const asRoute = (p: string) => p.replace(/\/\d+$/, "/[id]");

  const destinations = [
    // Exact paths, one per entry in EXACT.
    "/dashboard",
    "/inbox",
    "/conversations",
    "/tee-times",
    "/tee-times/interested",
    "/tee-times/requests",
    "/tee-times/confirmed",
    "/marketplace",
    "/dashboard/listings",
    "/dashboard/selling",
    "/dashboard/buying",
    "/dashboard/orders",
    "/dashboard/payouts",
    "/dashboard/connections",
    "/dashboard/profile",
    "/community",
    "/members",
    "/courses",
    // And one of each pattern.
    "/conversations/1",
    "/marketplace/1",
    "/tee-times/1",
    "/dashboard/orders/1",
    "/dashboard/orders/1/checkout",
  ];

  for (const href of destinations) {
    it(`${href} lands on a real screen`, () => {
      const route = appRouteFor(href);
      expect(route.kind).toBe("native");
      expect(routes).toContain(asRoute(route.path));
    });
  }

  /**
   * THE PUSH NOTIFICATION TAP USES THIS TOO, and for a while it did not.
   *
   * There are two ways to open the same notification: tapping its row in the
   * inbox, and tapping the system notification. The first went through
   * appRouteFor() from the day it was written; the second pushed `data.href`
   * straight into expo-router, so a tee-time push landed on expo-router's
   * "Unmatched Route" screen — the href is a path on pinpals.ie, and the app
   * has no /tee-times/interested.
   *
   * Nothing in a unit test can reach _layout.tsx's effect. What this can do
   * is pin the hrefs the push server actually sends, so if one is ever added
   * that this table does not handle, it fails here rather than on somebody's
   * lock screen.
   */
  const PUSH_HREFS = [
    // src/lib/tee-times-server.ts — the one that was broken.
    "/tee-times/interested",
    "/tee-times/requests",
    "/tee-times/confirmed",
    "/tee-times",
    // src/lib/messaging-server.ts
    "/conversations/412",
    // src/lib/orders.ts and src/lib/stripe/payments.ts
    "/dashboard/orders/5",
    "/dashboard/orders/5/checkout",
    "/dashboard/buying?tab=delivery",
    "/dashboard/selling?tab=sales",
    // 0056_marketplace_notifications_reviews.sql
    "/marketplace/88",
  ];

  for (const href of PUSH_HREFS) {
    it(`a push carrying ${href} opens a real screen`, () => {
      const route = appRouteFor(href);
      expect(route.kind).toBe("native");
      expect(routes).toContain(asRoute(route.path));
    });
  }

  it("found the app directory at all", () => {
    // Guards the guard: if APP_DIR were wrong, `routes` would be empty and
    // every assertion above would fail for the wrong reason.
    expect(routes.size).toBeGreaterThan(15);
    expect(routes).toContain("/");
  });

  it("sends feed alerts to the native post, and member links to the native member page", () => {
    expect(appRouteFor("/feed/57")).toEqual({ kind: "native", path: "/post/57" });
    expect(appRouteFor("/live/rounds/12")).toEqual({ kind: "native", path: "/live/round/12" });
    expect(appRouteFor("/live/days/3")).toEqual({ kind: "native", path: "/live/day/3" });
    expect(appRouteFor("/live/days/x").kind).toBe("web");
    expect(appRouteFor("/feed")).toEqual({ kind: "native", path: "/feed" });
    expect(appRouteFor("/members/0b6f1a3e-8c2d-4f5a-9e7b-1c2d3e4f5a6b")).toEqual({
      kind: "native",
      path: "/member/0b6f1a3e-8c2d-4f5a-9e7b-1c2d3e4f5a6b",
    });
    // Not a uuid: nothing native would know what to do with it.
    expect(appRouteFor("/members/not-a-member").kind).toBe("web");
    expect(appRouteFor("/feed/abc").kind).toBe("web");
  });
});
