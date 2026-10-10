import { router } from "expo-router";

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

/** Every invite button opens "Bring your fourball" (app/invite-friends.tsx):
 *  the member's own link and QR code, so whoever joins is connected to them. */
export function inviteFriends(): void {
  router.push("/invite-friends");
}

/** The plain link to the sign-up page, for anywhere without a member code. */
export const SIGNUP_URL = `${SITE_URL}/signup`;
