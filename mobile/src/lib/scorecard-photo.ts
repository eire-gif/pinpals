import { Linking, Platform, Share } from "react-native";

import { HAS_IMAGE_MANIPULATOR } from "./native-capabilities";
import { savedToPhotos, scorecardPhotoUrl } from "./scorecard-photo-url";
import { createScorecardShareLink } from "./scorecards";

/**
 * "Save photo" on a scorecard (Oct 2026, claude/scorecards.md).
 *
 * The picture is drawn by the website — c/[token]/photo, a 1080×1350 PNG of
 * the whole card — from the same signed link "Send" makes, so the app and the
 * public page always show the same card.
 *
 * No new native module, so this goes out over the air (the runtime
 * fingerprint means one would need a store build):
 *
 *   iPhone   fetch the PNG, write it to a file with expo-image-manipulator
 *            (already in the binary — see native-capabilities.ts), and open
 *            the share sheet with the file. The sheet's Save Image puts it in
 *            Photos; Instagram, WhatsApp and Messages take it as a picture.
 *   Android  React Native's Share is text only there, and attaching a file
 *            needs expo-sharing (a native build). Until then the picture
 *            opens in the browser as a download, which lands in the gallery.
 *   older    an iPhone binary without the manipulator opens the picture in
 *            Safari, where a long press saves it.
 */

export { savedToPhotos, scorecardPhotoUrl };

export type PhotoResult = "saved" | "shared" | "dismissed" | "opened";

function asDataUri(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Couldn't read the picture."));
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      // Some servers' blobs arrive untyped; the picture is always a PNG.
      resolve(result.replace(/^data:[^;,]*;base64,/, "data:image/png;base64,"));
    };
    reader.readAsDataURL(blob);
  });
}

export async function saveScorecardPhoto(scorecardId: number): Promise<PhotoResult> {
  const { url } = await createScorecardShareLink(scorecardId);
  const photoUrl = scorecardPhotoUrl(url);

  if (Platform.OS === "ios" && HAS_IMAGE_MANIPULATOR) {
    const res = await fetch(photoUrl);
    if (!res.ok) throw new Error(res.status === 404 ? "This scorecard isn't available." : "Couldn't make the picture. Please try again.");
    const dataUri = await asDataUri(await res.blob());
    // Lazily, as photo-picking.ts does: only binaries that have it get here.
    const { manipulateAsync, SaveFormat } = require("expo-image-manipulator") as typeof import("expo-image-manipulator");
    const file = await manipulateAsync(dataUri, [], { format: SaveFormat.PNG });
    const result = await Share.share({ url: file.uri });
    if (result.action === Share.dismissedAction) return "dismissed";
    return savedToPhotos(result.activityType) ? "saved" : "shared";
  }

  await Linking.openURL(Platform.OS === "android" ? `${photoUrl}?download=1` : photoUrl);
  return "opened";
}
