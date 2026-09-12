/* Pinpals service worker — push delivery only.
 *
 * Deliberately minimal. There is NO fetch handler here and no caching of
 * any kind: this app is server-rendered by Next on Vercel, and a service
 * worker that intercepts navigation is an excellent way to serve members a
 * stale, half-authenticated version of a page. The only reason this file
 * exists is that web push is undeliverable without a service worker.
 *
 * If offline support is ever wanted, it belongs in a separate, carefully
 * scoped fetch handler with an explicit allowlist — not bolted onto this one.
 *
 * This file is served as a static asset from /sw.js, so it is plain ES5-ish
 * JavaScript with no build step, no imports and no TypeScript.
 */

const NOTIFICATION_ICON = "/icons/icon-192.png";
const NOTIFICATION_BADGE = "/icons/badge-96.png";
const FALLBACK_HREF = "/dashboard";

self.addEventListener("install", () => {
  // Take over immediately rather than waiting for every tab to close —
  // there is no cached content whose version could conflict.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

/** Only ever trust a same-origin, absolute path out of the payload. The
 * payload is signed and encrypted in transit, but treating it as untrusted
 * here costs nothing and closes the open-redirect shape for good. */
function safeHref(value) {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//") ? value : FALLBACK_HREF;
}

/** Android and desktop render these as buttons under the notification; iOS
 * ignores them entirely, which is why neither is load-bearing.
 *
 * Both are NAVIGATION, not mutation. A button that accepts a tee time or an
 * offer straight from the lock screen would have to make an authenticated
 * write from inside the service worker, with no confirmation step and no
 * way to show an error — for an action that commits a member to being
 * somewhere at 08:40, or to selling a driver. Deep-linking to the invite is
 * one extra tap and keeps the decision on a screen that can explain itself.
 */
function actionsFor(type) {
  if (type === "tee_time_posted") {
    return [
      { action: "view", title: "View invite" },
      { action: "dismiss", title: "Not now" },
    ];
  }
  if (type === "offer_received" || type === "offer_countered") {
    return [
      { action: "view", title: "View offer" },
      { action: "dismiss", title: "Later" },
    ];
  }
  return [];
}

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (error) {
    payload = {};
  }

  const title = typeof payload.title === "string" && payload.title.length > 0 ? payload.title : "Pinpals";
  const body = typeof payload.body === "string" ? payload.body : "";
  const tag = typeof payload.tag === "string" && payload.tag.length > 0 ? payload.tag : "pinpals";
  const href = safeHref(payload.href);

  event.waitUntil(
    self.registration.showNotification(title, {
      body: body,
      tag: tag,
      icon: NOTIFICATION_ICON,
      badge: NOTIFICATION_BADGE,
      data: { href: href, type: payload.type },
      // A repeat of the same tag replaces the previous one silently rather
      // than buzzing again — the member has already been told.
      renotify: false,
      actions: actionsFor(payload.type),
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  if (event.action === "dismiss") return;

  const href = safeHref(event.notification.data && event.notification.data.href);
  const target = new URL(href, self.location.origin);

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });

      // Reuse an open Pinpals window if there is one — opening a second copy
      // of an installed PWA is disorienting, and on desktop it strands the
      // member in a window that has no history.
      for (const client of windows) {
        if (new URL(client.url).origin !== self.location.origin) continue;
        if ("focus" in client) await client.focus();
        if ("navigate" in client) {
          try {
            await client.navigate(target.href);
          } catch (error) {
            // Navigation can be refused (a cross-origin redirect mid-flight,
            // a client that has since been discarded). A focused window on
            // the wrong page beats no window at all.
          }
        }
        return;
      }

      if (self.clients.openWindow) await self.clients.openWindow(target.href);
    })()
  );
});

/* Browsers rotate a subscription's endpoint without warning — on a key
 * refresh, a long idle period, or a browser update. The old endpoint stops
 * working and the push service starts returning 410, which the server side
 * prunes on its next send.
 *
 * Re-subscribing here keeps the device working locally, but this worker
 * CANNOT tell the server about the new endpoint: doing so would need an
 * unauthenticated write endpoint, and handing the internet an unauthenticated
 * "register this device for notifications" route is not a trade worth
 * making for an edge case.
 *
 * Instead it self-heals on the member's next visit: PushOptIn re-registers
 * the current subscription on every mount, and register_push_subscription()
 * is an idempotent upsert keyed on the endpoint. The window of silence is
 * "until they next open Pinpals", which is precisely when they would have
 * seen the notification anyway.
 */
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const previous = event.oldSubscription || (await self.registration.pushManager.getSubscription());
        const applicationServerKey =
          (event.newSubscription && event.newSubscription.options && event.newSubscription.options.applicationServerKey) ||
          (previous && previous.options && previous.options.applicationServerKey);
        if (!applicationServerKey) return;

        await self.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: applicationServerKey,
        });
      } catch (error) {
        // Nothing useful to do from here; the next page load re-registers.
      }
    })()
  );
});
