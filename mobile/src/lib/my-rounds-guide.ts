import * as SecureStore from "expo-secure-store";

/**
 * Whether this member hid My rounds' "How a round comes together" strip
 * (Oct 2026). Kept on the phone, in the secure store the app already ships
 * (certify-device.ts uses it), so it goes out over the air — no new build.
 *
 * Per phone rather than per member: it's a "I've got it now" preference
 * about the screen, and a failed read shows the strip, which is the
 * harmless way to be wrong.
 */
const KEY = "my_rounds_guide_hidden";

export async function guideHidden(): Promise<boolean> {
  try {
    return (await SecureStore.getItemAsync(KEY)) === "1";
  } catch {
    return false;
  }
}

export async function hideGuide(): Promise<void> {
  try {
    await SecureStore.setItemAsync(KEY, "1");
  } catch {
    // Not stored: it'll show again next launch, which is all that's lost.
  }
}
