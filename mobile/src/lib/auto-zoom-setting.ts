import * as SecureStore from "expo-secure-store";

/**
 * Auto-zoom on the hole map (Oct 2026): on unless the member turns it off,
 * kept on the phone like yards / metres (distance-unit.ts).
 */
const KEY = "pp_hole_auto_zoom";

export async function loadAutoZoom(): Promise<boolean> {
  const v = await SecureStore.getItemAsync(KEY).catch(() => null);
  return v !== "off";
}

export async function saveAutoZoom(on: boolean): Promise<void> {
  await SecureStore.setItemAsync(KEY, on ? "on" : "off").catch(() => undefined);
}
