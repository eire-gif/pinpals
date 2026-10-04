import * as SecureStore from "expo-secure-store";

import { sharedRecapInviteIds } from "./feed";
import { roundsToRecap } from "./round-recap";
import { listConfirmedRounds, type ConfirmedRound } from "./rounds";
import { todayIso } from "./tee-times";

/**
 * "Share your round" offers (phase 7): which played rounds to suggest a
 * recap for, and remembering "Not now".
 *
 * A round is offered once it's been played (a confirmed tee time whose date
 * has passed — rounds.ts "Played"), for a fortnight, until the member shares
 * it or waves it away. Offering is all this does: the recap only becomes a
 * post when the member presses Post in the composer.
 *
 * "Not now" is remembered on the phone (expo-secure-store, which is already
 * in the build for the session; there's no AsyncStorage). A member who
 * dismisses on one phone may be offered it again on another — harmless.
 */

const KEY = "pinpals.recap.dismissed";
const KEEP = 60;

async function readDismissed(): Promise<number[]> {
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(list) ? list.filter((n): n is number => Number.isInteger(n)) : [];
  } catch {
    return [];
  }
}

export async function dismissRecap(inviteId: number): Promise<void> {
  const list = (await readDismissed()).filter((id) => id !== inviteId);
  list.unshift(inviteId);
  try {
    await SecureStore.setItemAsync(KEY, JSON.stringify(list.slice(0, KEEP)));
  } catch {
    // Not remembered: it will be offered again, which is the safe failure.
  }
}

/** Played rounds worth offering a recap for, most recent first. */
export async function loadRecapOffers(userId: string): Promise<ConfirmedRound[]> {
  const { past } = await listConfirmedRounds(userId);
  if (past.length === 0) return [];
  const [shared, dismissed] = await Promise.all([
    sharedRecapInviteIds(
      userId,
      past.map((r) => r.inviteId)
    ),
    readDismissed(),
  ]);
  return roundsToRecap(past, shared, new Set(dismissed), todayIso());
}
