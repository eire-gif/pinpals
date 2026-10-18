import { AppState, Platform } from "react-native";
import { requireOptionalNativeModule } from "expo-modules-core";

import { postToSite } from "./api";
import { SITE_URL } from "./config";
import type { LiveRound } from "./live-rounds";
import { isOneBallPerSide, playOrder, type CardHole } from "./live-scoring";
import { sendScore } from "./score-queue";
import { anySpots, lockScreenHole, lockScreenLinks, lockScreenSpots, lockScreenStrokes } from "./lock-screen-rules";
import { isOn } from "./features";
import { loadCourseLayouts } from "./hole-maps";
import type { LayoutPoint } from "./hole-geo";
import { voiceScoringEnabled } from "./native-capabilities";
import { loadCourse } from "./onboarding";
import { loadCourseShapes } from "./osm-fetch";
import { osmLayoutPoints } from "./osm-course";
import { startLockScreenDistance, stopLockScreenDistance } from "./lock-screen-location";

/**
 * Scoring from the lock screen (Oct 2026): the iPhone Live Activity.
 *
 * When a member opens a live round they're playing in, the card appears on
 * their lock screen (and in the Dynamic Island when the phone's unlocked):
 * the hole, par and stroke index, the number at net par, − / + and Save.
 * Their buttons work without unlocking the phone. The card goes when the
 * round is finished or deleted, or the member signs out.
 *
 * What lives where:
 *   - Swift (mobile/targets/widget): the card, its buttons and saving
 *     (_shared/LiveScoreShared.swift). Saves go to POST /api/widget/live/score
 *     with a key for this member and round, from
 *     POST /api/app/live/rounds/[id]/lock-screen-key.
 *   - The native module (mobile/modules/live-activity) is the bridge.
 *   - Here: when to start, refresh and end the card, and handing the app any
 *     lock screen scores that couldn't be sent for lack of signal.
 *
 * Voice scoring (claude/voice-scoring.md) adds two links to the card: a mic
 * that opens the round on the card's hole already listening, and the
 * distance to the green (lock-screen-location.ts), which opens the hole map.
 *
 * Only the member's own ball, and only in formats where everyone plays their
 * own ball — not a scramble team, a foursomes pair or a foursomes/greensomes
 * match, which are scored in the app. iPhone with iOS 17+ only; everywhere
 * else every call here does nothing.
 */

type Native = {
  isSupported(): boolean;
  start(json: string): string | null;
  update(json: string): string | null;
  end(json: string): string | null;
  takePending(): string;
  setGeometry(json: string): string | null;
  setLocation(json: string): string | null;
};

const native: Native | null = Platform.OS === "ios" ? requireOptionalNativeModule<Native>("PinPalsLiveActivity") : null;

/** A key is swapped for a fresh one when it has less than this left (they last 18 hours). */
const RENEW_WITHIN_MS = 2 * 3600 * 1000;
const keys = new Map<number, { token: string; expiresAt: number }>();
/** Rounds whose card this app session has started (start() also refreshes a card left from before). */
const started = new Set<number>();
/** Rounds where starting failed for a reason that won't change (format, not playing). */
const refused = new Set<number>();
/** Rounds whose greens have been handed to the card this session. */
const mapped = new Set<number>();

function supported(): boolean {
  try {
    return native?.isSupported() ?? false;
  } catch {
    return false;
  }
}

/** Formats where each player scores their own ball. */
export function lockScreenEligible(round: Pick<LiveRound, "scramble" | "matchFormat">): boolean {
  if (round.scramble != null) return false;
  if (round.matchFormat != null && isOneBallPerSide(round.matchFormat)) return false;
  return true;
}

function formatFor(round: Pick<LiveRound, "format" | "matchFormat">): "points" | "stroke" | "match" {
  if (round.matchFormat != null || round.format === "matchplay" || round.format === "fourball") return "match";
  return round.format === "stroke" ? "stroke" : "points";
}

async function keyFor(roundId: number): Promise<{ token: string; expiresAt: number } | null> {
  const have = keys.get(roundId);
  if (have && have.expiresAt - Date.now() > RENEW_WITHIN_MS) return have;
  try {
    const key = await postToSite<{ token: string; expiresAt: number }>(`/api/app/live/rounds/${roundId}/lock-screen-key`, {});
    keys.set(roundId, key);
    return key;
  } catch (e) {
    // 403/409: not playing, finished or a shared-ball format. Don't ask again
    // this session. Anything else (no signal): try again next time.
    const status = (e as { status?: number } | null)?.status;
    if (status === 403 || status === 409) refused.add(roundId);
    return have ?? null;
  }
}

export type LockScreenRound = {
  round: LiveRound;
  card: readonly CardHole[];
  /** The member's own player row in the round. */
  playerId: number;
  /** Their shots on a hole (null when the card's stroke index is missing). */
  shotsAt: (hole: number) => number | null;
  /** Their scores so far, including any waiting for signal. null = picked up. */
  scores: ReadonlyMap<number, number | null>;
  /** "2nd of 4", "Blues 2 UP"… or null. */
  status: string | null;
};

/**
 * The round screen loaded or a score went in: show the round on the lock
 * screen (starting the card the first time), or take it down if the round
 * is over.
 */
export async function syncLockScreen(input: LockScreenRound): Promise<void> {
  if (!native || !supported()) return;
  const { round } = input;
  if (round.status !== "live") {
    endLockScreen(round.id);
    return;
  }
  if (!lockScreenEligible(round) || refused.has(round.id)) return;

  const strokes = lockScreenStrokes(input.scores);
  // A shotgun group (0173) plays from its own hole round to the one before.
  const hole = lockScreenHole(playOrder(input.card, round.start?.hole ?? null), input.scores);
  const key = await keyFor(round.id);
  if (!key) return;
  const api = `${SITE_URL.replace(/\/$/, "")}/api/widget/live/score`;

  try {
    if (!started.has(round.id)) {
      const links = lockScreenLinks(round.id, round.clubId, { voice: isOn("voiceScoring") && voiceScoringEnabled(), map: isOn("shotMaps") });
      const failure = native.start(
        JSON.stringify({
          roundId: round.id,
          course: round.courseName,
          format: formatFor(round),
          holes: input.card.map((h) => ({ n: h.hole, par: h.par, si: h.strokeIndex, shots: input.shotsAt(h.hole) ?? 0 })),
          url: `pinpals://live/round/${round.id}`,
          api,
          token: key.token,
          playerId: input.playerId,
          hole,
          strokes,
          status: input.status,
          voiceUrl: links.voiceUrl,
          mapUrl: links.mapUrl,
        })
      );
      if (failure == null) {
        // Starting one round's card ends any other's.
        started.clear();
        started.add(round.id);
        void showDistance(round, input.card);
      }
      return;
    }
    const result = native.update(JSON.stringify({ roundId: round.id, hole, strokes, status: input.status, token: key.token, api, playerId: input.playerId }));
    // The member swiped the card away (or iOS ended it after 8 hours): leave
    // it gone for this round rather than putting it back on every score.
    if (result === "not running") {
      started.delete(round.id);
      refused.add(round.id);
      void stopLockScreenDistance();
    } else if (!mapped.has(round.id)) {
      void showDistance(round, input.card);
    }
  } catch {
    // The card is a convenience: scoring in the app carries on regardless.
  }
}

/**
 * The card's distance to the green: hand it where each green is (once a
 * round), then start the location updates that keep it current. A course
 * with no mapped greens gets neither — the card just has no distance.
 */
async function showDistance(round: LiveRound, card: readonly CardHole[]): Promise<void> {
  if (!native || round.clubId == null || mapped.has(round.id)) return;
  mapped.add(round.id);
  try {
    const layouts = await loadCourseLayouts(round.clubId).catch(() => []);
    // A club with several loops: the one with as many holes as this card.
    const layout = layouts.find((l) => l.holes === card.length) ?? layouts[0] ?? null;
    let osm: LayoutPoint[] = [];
    const provider = layout?.points ?? [];
    if (!card.every((h) => provider.some((p) => p.hole === h.hole && p.kind === "green_centre"))) {
      const club = await loadCourse(round.clubId).catch(() => null);
      if (club?.latitude != null && club.longitude != null) {
        const at = { lat: club.latitude, lng: club.longitude };
        osm = osmLayoutPoints(await loadCourseShapes(round.clubId, at), at);
      }
    }
    const spots = lockScreenSpots(card, provider, osm);
    if (!anySpots(spots)) return;
    native.setGeometry(JSON.stringify({ roundId: round.id, holes: spots }));
    await startLockScreenDistance();
  } catch {
    // No distance on the card; scoring carries on.
    mapped.delete(round.id);
  }
}

/** The round finished (immediate = it was deleted): take its card down. */
export function endLockScreen(roundId: number, summary?: string, immediate = false): void {
  started.delete(roundId);
  keys.delete(roundId);
  mapped.delete(roundId);
  void stopLockScreenDistance();
  if (!native) return;
  try {
    native.end(JSON.stringify({ roundId, summary: summary ?? null, immediate }));
  } catch {
    // Nothing to end.
  }
}

/** Signed out: every card goes at once, and its keys with it. */
export function endAllLockScreens(): void {
  started.clear();
  keys.clear();
  refused.clear();
  mapped.clear();
  void stopLockScreenDistance();
  if (!native) return;
  try {
    native.end(JSON.stringify({ roundId: null, summary: null, immediate: true }));
  } catch {
    // Nothing to end.
  }
}

type LockPending = { roundId: number; playerId?: number | null; hole: number; strokes?: number | null; clear: boolean; at: number };

let draining: Promise<number> | null = null;

/**
 * Scores saved on the lock screen with no signal, still waiting: the app
 * takes them over and sends them with its own queue (score-queue.ts), so
 * they go even if the lock screen is never touched again. Oldest first.
 */
export function drainLockScreenScores(): Promise<number> {
  if (!native) return Promise.resolve(0);
  if (draining) return draining;
  draining = (async () => {
    let items: LockPending[] = [];
    try {
      items = JSON.parse(native.takePending() || "[]") as LockPending[];
    } catch {
      return 0;
    }
    let handed = 0;
    for (const p of [...items].sort((a, b) => a.at - b.at)) {
      if (p.playerId == null) continue;
      try {
        await sendScore(p.roundId, p.playerId, p.hole, p.strokes ?? null, p.clear);
        handed += 1;
      } catch {
        // Refused by the database (the round finished): nothing to retry.
      }
    }
    return handed;
  })().finally(() => {
    draining = null;
  });
  return draining;
}

if (native) {
  AppState.addEventListener("change", (state) => {
    if (state === "active") void drainLockScreenScores();
  });
}
