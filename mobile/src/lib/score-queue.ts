import { AppState } from "react-native";
import * as SecureStore from "expo-secure-store";

import { setLiveScore } from "@/lib/live-rounds";
import { isNetworkError } from "@/lib/score-queue-rules";

export { isNetworkError };

/**
 * Scores entered with no signal (Oct 2026). On a links course in a sea fog
 * the phone often has no connection; a score must never be lost to that.
 *
 *   - A score that fails to send because there's no connection is kept here
 *     — the latest value per round, player and hole — and the card keeps
 *     showing it.
 *   - It's kept on the phone too (SecureStore, small and already in the app,
 *     so this ships without a new store build), so closing the app doesn't
 *     lose it.
 *   - It's sent again every 20 seconds, whenever the app comes back to the
 *     front, and before any newer score — oldest first, so the server ends
 *     with what was entered last.
 *   - A score the database refuses (the round finished, not your card) is
 *     dropped, not retried: that isn't a signal problem.
 */

export type PendingScore = { roundId: number; playerId: number; hole: number; strokes: number | null; clear: boolean; at: number };

const KEY = "pinpals.pendingScores.v1";
const RETRY_MS = 20_000;

let pending: PendingScore[] = [];
let loaded = false;
let timer: ReturnType<typeof setInterval> | null = null;
let flushing = false;
const listeners = new Set<(n: number) => void>();

const keyOf = (p: Pick<PendingScore, "roundId" | "playerId" | "hole">) => `${p.roundId}:${p.playerId}:${p.hole}`;

async function load(): Promise<void> {
  if (loaded) return;
  loaded = true;
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    const saved = raw ? (JSON.parse(raw) as PendingScore[]) : [];
    // Anything already queued this session wins over what was saved.
    const have = new Set(pending.map(keyOf));
    pending = [...saved.filter((p) => !have.has(keyOf(p))), ...pending];
  } catch {
    // Nothing saved, or unreadable: start empty.
  }
  if (pending.length) start();
}

async function save(): Promise<void> {
  try {
    if (pending.length === 0) await SecureStore.deleteItemAsync(KEY);
    // A compact copy: keys kept short so a full round's worth stays small.
    else await SecureStore.setItemAsync(KEY, JSON.stringify(pending.slice(-80)));
  } catch {
    // The copy in memory still sends while the app is open.
  }
}

function notify() {
  for (const l of listeners) l(pending.length);
}

function start() {
  if (timer) return;
  timer = setInterval(() => void flushScores(), RETRY_MS);
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

AppState.addEventListener("change", (state) => {
  if (state === "active") void flushScores();
});

/** Sends everything waiting, oldest first. Stops at the first lost connection. */
export async function flushScores(): Promise<number> {
  await load();
  if (flushing || pending.length === 0) return 0;
  flushing = true;
  let sent = 0;
  try {
    while (pending.length) {
      const next = pending[0];
      try {
        await setLiveScore(next.roundId, next.playerId, next.hole, next.strokes, next.clear);
        sent += 1;
      } catch (e) {
        if (isNetworkError(e)) break;
        // The database said no: drop it rather than retry forever.
      }
      pending = pending.filter((p) => p !== next);
    }
  } finally {
    flushing = false;
    if (pending.length === 0) stop();
    await save();
    notify();
  }
  return sent;
}

/**
 * Sends a score now; with no connection it's kept and sent later. Resolves
 * "sent" or "queued". Throws only when the database refused it.
 */
export async function sendScore(roundId: number, playerId: number, hole: number, strokes: number | null, clear = false): Promise<"sent" | "queued"> {
  await load();
  const item: PendingScore = { roundId, playerId, hole, strokes, clear, at: Date.now() };
  // A newer score for the same hole replaces any waiting one.
  pending = pending.filter((p) => keyOf(p) !== keyOf(item));
  if (pending.length > 0) {
    // Already offline: join the line, keep the order.
    pending.push(item);
    await save();
    notify();
    start();
    void flushScores();
    return "queued";
  }
  try {
    await setLiveScore(roundId, playerId, hole, strokes, clear);
    return "sent";
  } catch (e) {
    if (!isNetworkError(e)) throw e;
    pending.push(item);
    await save();
    notify();
    start();
    return "queued";
  }
}

/** Scores waiting for this round, to lay over what the server has. */
export async function pendingFor(roundId: number): Promise<PendingScore[]> {
  await load();
  return pending.filter((p) => p.roundId === roundId);
}

export function pendingCount(): number {
  return pending.length;
}

/** Called with the number waiting whenever it changes. Returns the unsubscribe. */
export function onPendingChange(fn: (n: number) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
