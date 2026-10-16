import { Alert, Platform } from "react-native";
import * as Location from "expo-location";
import * as SecureStore from "expo-secure-store";
import { requireOptionalNativeModule } from "expo-modules-core";

import { HAS_TASK_MANAGER } from "./native-capabilities";

/**
 * The lock screen card's distance to the green (Oct 2026, claude/voice-scoring.md).
 *
 * While a member's live round is on their lock screen, the phone's location
 * keeps coming in with the phone locked, and the card shows how far they
 * are from the centre of the green on the hole it's showing ("152 yds"), or
 * the hole's length from the tee when they aren't on it yet.
 *
 * How:
 *   - The updates are started from the round screen, in the foreground, so
 *     iOS lets them carry on in the background with only "While using the
 *     app" permission (UIBackgroundModes: location; the blue location pill
 *     shows while they run). No "Always" permission is needed.
 *   - Each fix goes straight to the card (PinPalsLiveActivityBridge.setLocation).
 *     The Swift side knows which hole the card is on — it may have moved on
 *     from the lock screen — and where that hole's green is, and does the
 *     sum. Nothing about where the member is leaves the phone.
 *   - It stops when the card goes: the round finished or was deleted, the
 *     member signed out or swiped the card away. A fix that finds no card
 *     stops it too, so it can never run on after a round.
 *
 * The task must be defined when the app starts (iOS may wake the app in the
 * background just to deliver a fix), so the root layout imports this file.
 */

const TASK = "pinpals-lock-screen-distance";
/** Fixes worse than this are no use for a yardage. */
const WORST_USABLE_M = 50;
const ASKED_KEY = "lockScreenDistanceAsked";

type Native = { setLocation(json: string): string | null };
const native: Native | null = Platform.OS === "ios" ? requireOptionalNativeModule<Native>("PinPalsLiveActivity") : null;

type TaskManager = typeof import("expo-task-manager");
function taskManager(): TaskManager | null {
  if (!HAS_TASK_MANAGER) return null;
  try {
    return require("expo-task-manager") as TaskManager;
  } catch {
    return null;
  }
}

const tm = native ? taskManager() : null;

if (tm && !tm.isTaskDefined(TASK)) {
  tm.defineTask<{ locations?: Location.LocationObject[] }>(TASK, async ({ data, error }) => {
    if (error || !data?.locations?.length) return;
    const fix = data.locations[data.locations.length - 1];
    const accuracy = fix.coords.accuracy ?? null;
    if (accuracy != null && accuracy > WORST_USABLE_M) return;
    let result: string | null = null;
    try {
      result = native?.setLocation(JSON.stringify({ lat: fix.coords.latitude, lng: fix.coords.longitude, accuracy })) ?? null;
    } catch {
      return;
    }
    // No card to show it on any more: stop rather than run on.
    if (result === "not running") void stopLockScreenDistance();
  });
}

export function lockScreenDistanceAvailable(): boolean {
  return tm != null && native != null;
}

let starting: Promise<void> | null = null;

/**
 * Starts the distance on the card. Asks for location once, with the reason
 * in front of the member, if they haven't already allowed it (for "Near me"
 * or the hole map); never asks again after a no.
 */
export function startLockScreenDistance(): Promise<void> {
  if (!lockScreenDistanceAvailable()) return Promise.resolve();
  if (starting) return starting;
  starting = (async () => {
    try {
      if (await Location.hasStartedLocationUpdatesAsync(TASK)) return;
      let { status, canAskAgain } = await Location.getForegroundPermissionsAsync();
      if (status !== "granted") {
        if (!canAskAgain || (await SecureStore.getItemAsync(ASKED_KEY)) === "1") return;
        await SecureStore.setItemAsync(ASKED_KEY, "1");
        const yes = await new Promise<boolean>((resolve) =>
          Alert.alert(
            "Distance to the green on your lock screen?",
            "While you're playing, the card on your lock screen can show how far you are from the green. Your location stays on your phone and it stops when the round ends.",
            [
              { text: "Not now", style: "cancel", onPress: () => resolve(false) },
              { text: "Show it", onPress: () => resolve(true) },
            ],
            { cancelable: true, onDismiss: () => resolve(false) }
          )
        );
        if (!yes) return;
        ({ status } = await Location.requestForegroundPermissionsAsync());
        if (status !== "granted") return;
      }
      await Location.startLocationUpdatesAsync(TASK, {
        accuracy: Location.Accuracy.High,
        distanceInterval: 4,
        activityType: Location.ActivityType.Fitness,
        pausesUpdatesAutomatically: false,
        // Required for updates to carry on in the background on "While using".
        showsBackgroundLocationIndicator: true,
      });
    } catch {
      // Location off, or no background mode in this build: the card shows
      // the hole's length instead, as before.
    } finally {
      starting = null;
    }
  })();
  return starting;
}

export async function stopLockScreenDistance(): Promise<void> {
  if (!lockScreenDistanceAvailable()) return;
  try {
    if (await Location.hasStartedLocationUpdatesAsync(TASK)) await Location.stopLocationUpdatesAsync(TASK);
  } catch {
    // Not running.
  }
}
