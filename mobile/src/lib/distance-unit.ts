import * as SecureStore from "expo-secure-store";

import type { Unit } from "@/lib/hole-geo";

/**
 * Yards or metres on the hole map, as the member last chose it. Kept on the
 * phone so it survives a restart (Phase A, Oct 2026) — before, it was
 * forgotten whenever the app was closed. The lock screen card and the
 * Apple Watch are still yards only: they're native and change with the next
 * store build.
 */
const KEY = "pp_distance_unit";

export async function loadDistanceUnit(): Promise<Unit | null> {
  const v = await SecureStore.getItemAsync(KEY).catch(() => null);
  return v === "yards" || v === "metres" ? v : null;
}

export async function saveDistanceUnit(u: Unit): Promise<void> {
  await SecureStore.setItemAsync(KEY, u).catch(() => undefined);
}
