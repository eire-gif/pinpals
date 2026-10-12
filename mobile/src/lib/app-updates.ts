import * as Updates from "expo-updates";

/**
 * Take an over-the-air update at launch instead of one launch later.
 *
 * expo-updates on its own checks at launch, downloads in the background and
 * only switches to the new version on the NEXT cold start. So a feature
 * published with `eas update` reached most members a launch late — and a
 * notification about something new (a certify request, 0128) could open in
 * the old version, which had no screen for it and fell back to the website.
 *
 * Now: on a cold start, check; if there's a new update and it arrives within
 * a few seconds (the member is still on the splash or the first screen),
 * reload straight into it. Slower than that and it's left for the next
 * launch, as before — never yank the app out from under someone mid-task.
 * Silent and best-effort: offline, dev builds and Expo Go do nothing.
 */
const RELOAD_WINDOW_MS = 6000;

let started = false;

export async function applyUpdateAtLaunch(): Promise<void> {
  if (started || __DEV__ || !Updates.isEnabled) return;
  started = true;
  const t0 = Date.now();
  try {
    const check = await Updates.checkForUpdateAsync();
    if (!check.isAvailable) return;
    const fetched = await Updates.fetchUpdateAsync();
    if (!fetched.isNew) return;
    if (Date.now() - t0 > RELOAD_WINDOW_MS) return; // applies next launch instead
    await Updates.reloadAsync();
  } catch {
    // No signal, server hiccup: the next launch picks it up.
  }
}
