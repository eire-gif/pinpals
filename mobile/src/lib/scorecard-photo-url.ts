/** Pure parts of "Save photo" (scorecard-photo.ts), tested without React Native. */

/** Where the picture lives for a card's share link (…/c/<token> → …/c/<token>/photo). */
export function scorecardPhotoUrl(shareUrl: string): string {
  const u = shareUrl.replace(/[?#].*$/, "").replace(/\/+$/, "");
  return `${u}/photo`;
}

/** True when the share sheet's choice was "Save Image" (iOS reports the activity). */
export const savedToPhotos = (activityType: string | null | undefined): boolean =>
  typeof activityType === "string" && /SaveToCameraRoll/i.test(activityType);
