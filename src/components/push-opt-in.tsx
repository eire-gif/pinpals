"use client";

import { useCallback, useEffect, useState } from "react";
import { savePushSubscription, removePushSubscription } from "@/app/dashboard/notifications/actions";

/**
 * The browser-side half of push: registers the service worker, asks for
 * permission, and hands the resulting subscription to the server.
 *
 * Three things about this are not obvious and are worth not "simplifying"
 * later:
 *
 * 1. PERMISSION MUST BE REQUESTED FROM A REAL TAP. Calling
 *    Notification.requestPermission() on mount is refused outright by Safari
 *    and ignored-then-penalised by Chrome. It only ever happens inside the
 *    button's click handler below.
 *
 * 2. ON IPHONE, NONE OF THIS WORKS UNTIL THE APP IS ON THE HOME SCREEN.
 *    Safari exposes PushManager in a plain tab but refuses to subscribe. So
 *    an iOS device that isn't running standalone gets Add-to-Home-Screen
 *    instructions instead of a button that would fail. Android has no such
 *    requirement and goes straight to the button.
 *
 * 3. IT RE-REGISTERS ON EVERY MOUNT when permission is already granted.
 *    That is not redundant — browsers rotate subscription endpoints without
 *    telling the server, and the service worker cannot report the new one
 *    (see the pushsubscriptionchange comment in public/sw.js). This mount
 *    effect is what heals that, and register_push_subscription() is an
 *    idempotent upsert keyed on the endpoint, so the repeat costs one cheap
 *    write.
 */

type PushState =
  | "checking"
  | "unsupported"
  | "needs-install" // iOS, not yet added to the home screen
  | "prompt"
  | "granted"
  | "denied"
  | "working";

/** The VAPID public key arrives as base64url and must reach
 * pushManager.subscribe() as bytes. */
function urlBase64ToUint8Array(base64UrlString: string): Uint8Array {
  const padding = "=".repeat((4 - (base64UrlString.length % 4)) % 4);
  const base64 = (base64UrlString + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}

function isIos(): boolean {
  const ua = window.navigator.userAgent;
  // iPadOS 13+ reports itself as a Mac; the touch-point check is the
  // standard way to tell a real Mac from an iPad pretending to be one.
  return /iphone|ipod|ipad/i.test(ua) || (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1);
}

function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export default function PushOptIn() {
  const [state, setState] = useState<PushState>("checking");
  const [error, setError] = useState<string | null>(null);

  const register = useCallback(async (): Promise<boolean> => {
    const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    if (!vapidKey) {
      setError("Push notifications aren't configured on this site yet.");
      return false;
    }

    const registration = await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;

    const existing = await registration.pushManager.getSubscription();
    const subscription =
      existing ??
      (await registration.pushManager.subscribe({
        // Required by every browser: a push must always result in a visible
        // notification. Silent background pushes are not available to us.
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey) as BufferSource,
      }));

    const json = subscription.toJSON();
    if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
      setError("This browser returned an incomplete subscription. Try again, or use a different browser.");
      return false;
    }

    const result = await savePushSubscription({
      endpoint: json.endpoint,
      p256dh: json.keys.p256dh,
      auth: json.keys.auth,
      userAgent: window.navigator.userAgent,
    });

    if (result.error) {
      setError(result.error);
      return false;
    }
    return true;
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        if (!cancelled) setState("unsupported");
        return;
      }

      if (isIos() && !isStandalone()) {
        if (!cancelled) setState("needs-install");
        return;
      }

      if (Notification.permission === "denied") {
        if (!cancelled) setState("denied");
        return;
      }

      if (Notification.permission !== "granted") {
        if (!cancelled) setState("prompt");
        return;
      }

      // Already granted: silently re-register so a rotated endpoint heals.
      try {
        await register();
      } catch {
        // A failure here is invisible to the member on purpose — they
        // already said yes, and there is nothing for them to act on.
      }
      if (!cancelled) setState("granted");
    })();

    return () => {
      cancelled = true;
    };
  }, [register]);

  async function handleEnable() {
    setError(null);
    setState("working");
    try {
      const permission = await Notification.requestPermission();
      if (permission === "denied") {
        setState("denied");
        return;
      }
      if (permission !== "granted") {
        setState("prompt");
        return;
      }
      const ok = await register();
      setState(ok ? "granted" : "prompt");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Couldn't turn on notifications.");
      setState("prompt");
    }
  }

  async function handleDisable() {
    setError(null);
    setState("working");
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        await removePushSubscription(subscription.endpoint);
        await subscription.unsubscribe();
      }
      setState("prompt");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Couldn't turn off notifications on this device.");
      setState("granted");
    }
  }

  if (state === "checking" || state === "unsupported") return null;

  return (
    <div className="bg-surface border border-line rounded-2xl p-6">
      <h2 className="font-display font-bold text-lg text-ink-900">Notifications on this device</h2>

      {state === "needs-install" && (
        <div className="mt-2">
          <p className="text-sm text-ink-500">
            On iPhone and iPad, Pinpals has to be on your home screen before it can send notifications. It takes two
            taps:
          </p>
          <ol className="mt-3 flex flex-col gap-2 text-sm text-ink-900">
            <li>
              1. Tap <strong>Share</strong> in the Safari toolbar
            </li>
            <li>
              2. Choose <strong>Add to Home Screen</strong>
            </li>
            <li>3. Open Pinpals from your home screen and come back here</li>
          </ol>
        </div>
      )}

      {state === "prompt" && (
        <>
          <p className="mt-2 text-sm text-ink-500">
            Get told the moment a connection posts a tee time or someone makes an offer on your listing — without
            waiting on email.
          </p>
          <button
            type="button"
            onClick={handleEnable}
            className="mt-4 px-5 py-2.5 rounded-full font-bold text-sm bg-green-700 text-cream-50 hover:bg-green-600 transition"
          >
            Turn on notifications
          </button>
        </>
      )}

      {state === "working" && <p className="mt-2 text-sm text-ink-500">Just a moment…</p>}

      {state === "granted" && (
        <>
          <p className="mt-2 text-sm text-ink-500">
            This device is set up. Use the table above to choose which activity is worth a notification.
          </p>
          <button
            type="button"
            onClick={handleDisable}
            className="mt-4 px-5 py-2.5 rounded-full font-bold text-sm border border-line text-ink-900 hover:bg-cream-100 transition"
          >
            Turn off on this device
          </button>
        </>
      )}

      {state === "denied" && (
        <p className="mt-2 text-sm text-ink-500">
          Notifications are blocked for Pinpals in this browser&rsquo;s settings, so we can&rsquo;t ask again from
          here. You can allow them again in your browser&rsquo;s site settings for pinpals.ie.
        </p>
      )}

      {error && <p className="mt-4 text-sm text-red-600 bg-red-100 rounded-lg px-3.5 py-2.5">{error}</p>}
    </div>
  );
}
