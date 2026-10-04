import { Redirect } from "expo-router";

/**
 * Find PinPals used to be its own suggestions screen, with a link to "Search
 * every member" for anyone else. Tester feedback (4 Oct 2026): one place is
 * better. The directory (app/members.tsx) now leads with the same
 * suggestions, so this route only forwards there — kept so links, history
 * and anything already pointing at /find-pinpals still land somewhere.
 */
export default function FindPinPalsRedirect() {
  return <Redirect href="/members" />;
}
