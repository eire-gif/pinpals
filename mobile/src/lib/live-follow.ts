import { getFromSite, postToSite } from "@/lib/api";
import { supabase } from "@/lib/supabase";

/**
 * Follow my round (0158, claude/follow-my-round.md).
 *
 * A player shares their live card with someone who isn't playing — to a
 * PinPal (it opens in their app and on their Home Screen widget) or as a
 * link anyone can open in a browser. The website builds what a follower
 * sees (src/lib/follow-card.ts), so it's the same everywhere and never shows
 * more than the one card.
 *
 * The FollowCard type mirrors the website's src/lib/follow-card.ts; keep
 * them in step.
 */

export type FollowTone = "ace" | "albatross" | "eagle" | "birdie" | "par" | "bogey" | "double" | "pickup" | "none";

export type FollowHole = {
  hole: number;
  par: number;
  strokeIndex: number | null;
  shots: number;
  /** Gross; null = picked up; absent = not played yet (JSON drops undefined). */
  strokes?: number | null;
  value: string;
  tone: FollowTone;
};

export type FollowCard = {
  v: 1;
  state: "live" | "final";
  updatedAt: string;
  name: string;
  firstName: string;
  handicapLine: string;
  course: string;
  formatLabel: string;
  dateLabel: string;
  valueHeading: string;
  summary: { big: string; unit: string; progress: string; place: string | null; extra: string | null };
  nowPlaying: number | null;
  holes: FollowHole[];
  halves: { label: "Out" | "In"; par: number; strokes: string; value: string }[];
  cardIncomplete: boolean;
};

export type FollowingItem = { followId: number; sharedBy: string; card: FollowCard };

export type MyShare = {
  id: number;
  playerId: number;
  kind: "pinpal" | "link";
  followerId: string | null;
  name: string;
  createdAt: string;
  expiresAt: string;
};

/** A link anyone can open. Returned once: it isn't stored anywhere. */
export async function createFollowLink(roundId: number, playerId: number): Promise<string> {
  const res = await postToSite<{ url: string | null }>(`/api/app/live/rounds/${roundId}/follow`, { playerId, link: true });
  if (!res.url) throw new Error("Couldn't make a link. Please try again.");
  return res.url;
}

/** Send the card to PinPals; they're told in the app. */
export async function shareWithPinPals(roundId: number, playerId: number, followers: string[]): Promise<number> {
  const res = await postToSite<{ shared: number }>(`/api/app/live/rounds/${roundId}/follow`, { playerId, followers });
  return res.shared;
}

export async function loadMyShares(roundId: number): Promise<MyShare[]> {
  const res = await getFromSite<{ shares: MyShare[] }>(`/api/app/live/rounds/${roundId}/follow`);
  return res.shares;
}

/** Stop a share: whoever made it, whose card it is, or the follower. */
export async function stopFollow(followId: number): Promise<void> {
  const { error } = await supabase.rpc("live_follow_stop", { p_follow_id: followId });
  if (error) throw error;
}

export async function loadFollowing(): Promise<FollowingItem[]> {
  const res = await getFromSite<{ following: FollowingItem[] }>("/api/app/live/follows");
  return res.following;
}

export async function loadFollowCard(followId: number): Promise<FollowCard> {
  const res = await getFromSite<{ card: FollowCard }>(`/api/app/live/follows/${followId}`);
  return res.card;
}

/** "Birdie for Aoife on the 7th!" — what's new since the last load. */
export function newHighlight(before: FollowCard | null, after: FollowCard): { hole: number; word: string } | null {
  if (!before) return null;
  const was = new Map(before.holes.map((h) => [h.hole, h.strokes]));
  const WORD: Partial<Record<FollowTone, string>> = { ace: "Hole in one", albatross: "Albatross", eagle: "Eagle", birdie: "Birdie" };
  for (const h of after.holes) {
    if (h.strokes === undefined || h.strokes === was.get(h.hole)) continue;
    const word = WORD[h.tone];
    if (word) return { hole: h.hole, word };
  }
  return null;
}

/** "Expires in 3h" / "Expires in 20 min" for Who's watching. */
export function expiresLabel(expiresAt: string, now = Date.now()): string {
  const mins = Math.max(0, Math.round((new Date(expiresAt).getTime() - now) / 60000));
  if (mins >= 90) return `Stops by itself in ${Math.round(mins / 60)}h`;
  return `Stops by itself in ${mins} min`;
}
