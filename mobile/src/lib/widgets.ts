import { Platform } from "react-native";
import { ExtensionStorage } from "@bacons/apple-targets";

import { postToSite } from "./api";
import { SITE_URL } from "./config";

/**
 * The bridge to the Home Screen widgets (Oct 2026; Swift in
 * mobile/targets/widget). The widget runs outside the app, so it can't use
 * the member's session: the app gives it a signed widget key
 * (POST /api/app/widget/token) through the shared App Group, and the widget
 * fetches its own scoreboard with it (GET /api/widget/live).
 *
 * iPhone only. On Android, and on builds from before the widget, the
 * native module isn't there and @bacons/apple-targets quietly does nothing.
 */

const APP_GROUP = "group.ie.pinpals.app";
const storage = Platform.OS === "ios" ? new ExtensionStorage(APP_GROUP) : null;
/** Swap the key for a fresh one when it has less than this left (it lasts 180 days). */
const RENEW_WITHIN_MS = 30 * 24 * 3600 * 1000;

/** After sign-in: make sure the widget has a key for this member. */
export async function connectWidget(userId: string): Promise<void> {
  if (!storage) return;
  try {
    const owner = storage.get("widgetOwner");
    const exp = Number(storage.get("widgetTokenExp") ?? 0);
    if (owner !== userId || !Number.isFinite(exp) || exp - Date.now() < RENEW_WITHIN_MS) {
      const { token, expiresAt } = await postToSite<{ token: string; expiresAt: number }>("/api/app/widget/token", {});
      storage.set("widgetToken", token);
      storage.set("widgetTokenExp", String(expiresAt));
      storage.set("widgetOwner", userId);
      // A different member on this phone mustn't see the last one's board.
      if (owner && owner !== userId) storage.remove("widgetLastPayload");
    }
    storage.set("widgetApi", `${SITE_URL.replace(/\/$/, "")}/api/widget/live`);
    ExtensionStorage.reloadWidget();
  } catch {
    // The widget says "open PinPals" until the next try; nothing else depends on it.
  }
}

/** Signed out: the widget forgets the member and their scoreboard. */
export function disconnectWidget(): void {
  if (!storage) return;
  try {
    for (const key of ["widgetToken", "widgetTokenExp", "widgetOwner", "widgetLastPayload"]) storage.remove(key);
    ExtensionStorage.reloadWidget();
  } catch {
    // Nothing to undo.
  }
}

let lastReload = 0;
let pending: ReturnType<typeof setTimeout> | null = null;
const GAP_MS = 15_000;

/**
 * A score went in (or a game started or finished): ask the widget to fetch
 * again. At most once every 15 seconds, with the last change always sent,
 * so a group tapping in four scores makes one request, not four.
 */
export function refreshWidget(): void {
  if (!storage) return;
  const wait = lastReload + GAP_MS - Date.now();
  if (wait <= 0) {
    lastReload = Date.now();
    try {
      ExtensionStorage.reloadWidget();
    } catch {
      // Widget not installed: fine.
    }
    return;
  }
  if (pending) return;
  pending = setTimeout(() => {
    pending = null;
    refreshWidget();
  }, wait);
}
