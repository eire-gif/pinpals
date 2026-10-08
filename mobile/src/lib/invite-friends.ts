import { Share } from "react-native";

import { SITE_URL } from "@/lib/config";

/**
 * "Invite friends to PinPals" — the system share sheet with a link to join.
 *
 * One function behind every invite button in the app (the banner in lists,
 * the menu, Profile, the connections and new-message screens), so the words
 * and the link are the same wherever a member taps it.
 *
 * Share, not a contacts picker: no permission prompt, no address book leaving
 * the phone, and the member picks WhatsApp or Messages themselves, which is
 * where their golf group already lives.
 */
export const INVITE_MESSAGE =
  "I've joined PinPals — golfers swapping tee times, at home and abroad, and selling gear. Join me:";

export function inviteFriends(): void {
  void Share.share({ message: `${INVITE_MESSAGE} ${SITE_URL}/signup` });
}
