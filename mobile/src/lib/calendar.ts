import { Alert, Linking } from "react-native";

import { postToSite } from "./api";

/**
 * "Add to calendar" (Oct 2026). The website checks the member is in the
 * round and hands back a link to an .ics file; opening it in Safari shows
 * the event with "Add to Calendar" (src/lib/calendar-ics.ts on the site).
 * No calendar permission, no native module — it ships over the air.
 */
export type CalendarKind = "tee_time" | "match_day";

export async function addToCalendar(kind: CalendarKind, id: number): Promise<void> {
  try {
    const { url } = await postToSite<{ url: string }>("/api/app/calendar", { kind, id });
    await Linking.openURL(url);
  } catch (err) {
    Alert.alert("Couldn't add it to your calendar", err instanceof Error ? err.message : "Please try again.");
  }
}

/** Asked once, at the moment a round becomes yours: posted, or confirmed. */
export function offerCalendar(kind: CalendarKind, id: number, title: string, body: string): void {
  Alert.alert(title, body, [
    { text: "Not now", style: "cancel" },
    { text: "Add to calendar", onPress: () => void addToCalendar(kind, id) },
  ]);
}
