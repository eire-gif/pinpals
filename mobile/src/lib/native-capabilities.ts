import { requireOptionalNativeModule } from "expo";

import { FEATURES } from "./features";

/**
 * Which native modules the installed app binary actually contains.
 *
 * Video playback (expo-video) and on-phone photo resizing
 * (expo-image-manipulator) arrived in a TestFlight build after 1.0.0 (5).
 * The runtime fingerprint means an over-the-air update containing them only
 * reaches binaries that have them. This check is the second guard: nothing
 * here ever imports one of those packages on a binary without its native
 * half, which would crash at launch rather than fail politely.
 *
 * Screens import the packages lazily (require() inside the code path that
 * needs them), gated on these values.
 */
export const HAS_VIDEO_PLAYER = requireOptionalNativeModule("ExpoVideo") != null;
export const HAS_IMAGE_MANIPULATOR = requireOptionalNativeModule("ExpoImageManipulator") != null;

/** Videos can be posted and played: the feature is on and the binary can. */
export const videoEnabled = (): boolean => FEATURES.video && HAS_VIDEO_PLAYER;
