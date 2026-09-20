import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import { supabase } from "./supabase";

/**
 * The client half of push. The database half has been live since 19
 * September: `push_subscriptions` takes a native token (0079),
 * `register_push_subscription` writes `auth.uid()` rather than a parameter,
 * and `notify_user()` already decides whether an event is a duplicate. None
 * of that is re-implemented here — this file's whole job is to get an Expo
 * token into that table and to route a tap.
 *
 * Why this matters more than it sounds: on iOS, web push only works for a
 * PWA the member manually added to their home screen, and it is fragile.
 * Until this ran, a host learned that someone wanted to join their fourball
 * only when they next happened to open the app — which is the opposite of the
 * feature. This is also the strongest argument at App Store review that the
 * app is not a repackaged website (Guideline 4.2).
 */

// Foreground behaviour. Without this, a notification that arrives while the
// member is looking at the app is delivered silently to the tray and they
// never see it — which reads as push being broken.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

/** Mirrors what describeDevice() in src/lib/push.ts looks for, so the device
 *  list on /dashboard/notifications says "iPhone" rather than "Unknown
 *  device". It is a hint to help a member recognise which device to remove,
 *  not a fingerprint. */
function deviceLabel(): string {
  const model = Device.modelName ?? (Platform.OS === "ios" ? "iPhone" : "Android");
  const os = Device.osVersion ? ` ${Device.osVersion}` : "";
  return `${model} (PinPals app, ${Platform.OS}${os})`;
}

export type RegisterResult =
  | { ok: true; token: string }
  | { ok: false; reason: "simulator" | "denied" | "no-project-id" | "failed" };

/**
 * Asks for permission, gets an Expo token, and files it against the signed-in
 * member.
 *
 * Deliberately returns a reason rather than throwing. Every caller is a side
 * effect of signing in, and failing to register for push must never stop a
 * member using the app — the same "never fail the thing that caused it" rule
 * the server's notifyUser() follows.
 */
export async function registerForPush(): Promise<RegisterResult> {
  // A simulator has no APNs registration, so getExpoPushTokenAsync throws
  // there rather than returning anything useful.
  if (!Device.isDevice) return { ok: false, reason: "simulator" };

  if (Platform.OS === "android") {
    // Android 8+ drops notifications that arrive with no channel. Harmless
    // on iOS, and doing it before the permission prompt means the first
    // notification after granting has somewhere to land.
    await Notifications.setNotificationChannelAsync("default", {
      name: "PinPals",
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }

  const existing = await Notifications.getPermissionsAsync();
  let granted = existing.granted;

  // iOS allows exactly one system prompt per install. Asking again after a
  // refusal does nothing visible, so a member who declined has to go to
  // Settings — which is why the app should only reach here off a deliberate
  // action (signing in), not on first launch behind a splash screen.
  if (!granted && existing.canAskAgain) {
    const asked = await Notifications.requestPermissionsAsync();
    granted = asked.granted;
  }

  if (!granted) return { ok: false, reason: "denied" };

  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ??
    Constants.easConfig?.projectId;

  // Without the project id, Expo cannot tell which project's token to mint
  // and throws something unhelpful. app.json carries it; this guard exists so
  // that if it ever goes missing the failure names itself.
  if (!projectId) return { ok: false, reason: "no-project-id" };

  try {
    const { data: token } = await Notifications.getExpoPushTokenAsync({
      projectId,
    });

    // p_p256dh and p_auth are omitted: they default to null, and 0079's
    // CHECK only requires them for platform 'web'. The function assigns the
    // row to auth.uid(), so there is no way to register a device to anyone
    // else.
    const { error } = await supabase.rpc("register_push_subscription", {
      p_endpoint: token,
      p_user_agent: deviceLabel(),
      p_platform: Platform.OS === "ios" ? "ios" : "android",
    });

    if (error) {
      console.warn("[push] register_push_subscription failed:", error.message);
      return { ok: false, reason: "failed" };
    }

    return { ok: true, token };
  } catch (err) {
    console.warn("[push] Could not get an Expo push token:", err);
    return { ok: false, reason: "failed" };
  }
}

/** Where a notification says it wants to go. The server puts this in `data`;
 *  it is the same `href` the web payload carries, so both channels deep-link
 *  to the same place and there is one definition of where an event leads. */
export function hrefFromNotification(
  notification: Notifications.Notification | null | undefined
): string | null {
  const data = notification?.request?.content?.data as
    | { href?: unknown }
    | undefined;
  const href = data?.href;

  // Only in-app paths. A notification is attacker-influenced in principle
  // (the server builds it, but from member-supplied club names and so on),
  // and router.push() of an arbitrary string is not somewhere to be relaxed.
  return typeof href === "string" && href.startsWith("/") ? href : null;
}
