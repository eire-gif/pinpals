import * as SecureStore from "expo-secure-store";

import { postToSite } from "@/lib/api";

/**
 * Filling an open place (0132): invite PinPals members, or share a link.
 *
 * The host or anyone with a confirmed place can do either. Saying yes is
 * unchanged — the invited golfer asks for the place and the host confirms —
 * so nothing here offers a place by itself. The rules (who may, who's
 * skipped) are the database's; the link is signed by the website, which is
 * why both go through it.
 */

/** The round's share link, signed for the signed-in member. */
export async function teeTimeShareUrl(inviteId: number): Promise<string> {
  const { url } = await postToSite<{ url: string }>(`/api/app/tee-times/invites/${inviteId}/share`, {});
  return url;
}

/** Invite members; resolves to how many were newly invited and told. */
export async function inviteToTeeTime(inviteId: number, memberIds: string[]): Promise<number> {
  const { invited } = await postToSite<{ invited: number }>(`/api/app/tee-times/invites/${inviteId}/invite`, { member_ids: memberIds });
  return invited;
}

/** A shared link opened signed in: adds you to the round and says which it is. */
export async function claimTeeTimeLink(token: string): Promise<number> {
  const { invite_id } = await postToSite<{ invite_id: number }>("/api/app/tee-times/link", { token });
  return invite_id;
}

/** "Golf at Portmarnock on Sat 17 Oct? There's a place for you: <link>" */
export function teeTimeShareMessage(input: { clubName: string; dateLabel: string; timeLabel: string; url: string }): string {
  return `⛳ Fancy a game? ${input.clubName}, ${input.dateLabel} · ${input.timeLabel}. There's a place for you — tap to ask for it on PinPals: ${input.url}`;
}

// ---------------------------------------------------------------------------
// A link opened before signing in
// ---------------------------------------------------------------------------

const PENDING_KEY = "pp_pending_tee_link";
const TOKEN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

export const isTeeTimeToken = (token: unknown): token is string => typeof token === "string" && token.length <= 300 && TOKEN.test(token);

export async function rememberPendingTeeLink(token: string): Promise<void> {
  if (!isTeeTimeToken(token)) return;
  await SecureStore.setItemAsync(PENDING_KEY, token).catch(() => undefined);
}

/** Called once signed in (app/_layout.tsx): claim it, then forget it. The round's id, or null. */
export async function consumePendingTeeLink(): Promise<number | null> {
  const token = await SecureStore.getItemAsync(PENDING_KEY).catch(() => null);
  if (!token) return null;
  await SecureStore.deleteItemAsync(PENDING_KEY).catch(() => undefined);
  try {
    return await claimTeeTimeLink(token);
  } catch {
    return null;
  }
}
