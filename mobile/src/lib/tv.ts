import { postToSite } from "./api";

export { normaliseTvCode, tidyTvCodeInput } from "./tv-code";

/**
 * Show on TV (Oct 2026): put a round or society day's leaderboard on a
 * clubhouse TV. The TV opens pinpals.ie/tv and shows a six-character code;
 * typing it here pairs that TV with this game. Without a code the website
 * hands back the TV link itself, to open on a laptop, a smart TV's browser
 * or an iPad mirrored with AirPlay. Website side: src/app/api/app/live/tv,
 * src/app/tv (claude/clubhouse-tv.md).
 */

export type TvTarget = { kind: "day" | "round"; id: number };

export async function connectTv(target: TvTarget, code: string): Promise<{ url: string; paired: boolean }> {
  return postToSite("/api/app/live/tv", { kind: target.kind, id: target.id, code });
}

export async function tvLink(target: TvTarget): Promise<string> {
  const { url } = await postToSite<{ url: string; paired: boolean }>("/api/app/live/tv", { kind: target.kind, id: target.id });
  return url;
}
