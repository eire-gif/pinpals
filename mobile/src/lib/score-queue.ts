import { AppState } from "react-native";
import * as SecureStore from "expo-secure-store";

import { setLiveDrive, setLiveScore } from "@/lib/live-rounds";
import { getStored, setStored } from "@/lib/phone-store";
import { isNetworkError, mergePending, pendingKey, withinTime, type PendingScore } from "@/lib/score-queue-rules";

export { isNetworkError };
export type { PendingScore };

/**
 * Scores entered with no signal (Oct 2026, claude/offline-scoring.md). On a
 * links course in a sea fog the phone often has no connection; a score
 * must never be lost to that.
 *
 *   - A score (or a scramble's drive) that fails to send because there's no
 *     connection is kept here — the latest value per round, player and hole
 *     — and the card keeps showing it.
 *   - It's kept on the phone too (phone-store.ts: a file, so a whole round
 *     fits), so closing the app or a flat battery doesn't lose it.
 *   - It's sent again every 15 seconds, whenever the app comes back to the
 *     front, and before any newer score — oldest first, so the server ends
 *     with what was entered last.
 *   - A score the database refuses (the round finished, not your card) is
 *     dropped, not retried: that isn't a signal problem.
 *
 * Before Oct 2026 the copy on the phone was one SecureStore value, which
 * refuses anything over about 2 KB — around 20 scores. It's read once and
 * moved across.
 */

const KEY = "pending-scores-v2";
const OLD_KEY = "pinpals.pendingScores.v1";
const RETRY_MS = 15_000;
/** A whole society day's worth for one phone, with room to spare. */
const MAX_KEPT = 600;

let pending: PendingScore[] = [];
let loaded: Promise<void> | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let flushing: Promise<number> | null = null;
const listeners = new Set<(n: number) => void>();

function load(): Promise<void> {
  if (!loaded) {
    loaded = (async () => {
      let saved = (await getStored<PendingScore[]>(KEY)) ?? [];
      try {
        const old = await SecureStore.getItemAsync(OLD_KEY);
        if (old) {
          saved = mergePending(JSON.parse(old) as PendingScore[], saved);
          await SecureStore.deleteItemAsync(OLD_KEY);
        }
      } catch {
        // Nothing in the old place.
      }
      // Anything already queued this session wins over what was saved.
      pending = mergePending(saved, pending);
      if (pending.length) {
        await save();
        start();
      }
    })();
  }
  return loaded;
}

async function save(): Promise<void> {
  await setStored(KEY, pending.slice(-MAX_KEPT));
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

/** How long one send may take on a weak signal before the score waits on the phone instead. */
const SEND_WAIT_MS = 10_000;

async function send(p: PendingScore): Promise<void> {
  const work = p.kind === "drive" ? setLiveDrive(p.roundId, p.hole, p.clear ? null : p.strokes) : setLiveScore(p.roundId, p.playerId, p.hole, p.strokes, p.clear);
  await withinTime(work, SEND_WAIT_MS);
}

/** Sends everything waiting, oldest first. Stops at the first lost connection. */
export function flushScores(): Promise<number> {
  if (flushing) return flushing;
  flushing = (async () => {
    await load();
    let sent = 0;
    try {
      while (pending.length) {
        const next = pending[0];
        try {
          await send(next);
          sent += 1;
        } catch (e) {
          if (isNetworkError(e)) break;
          // The database said no: drop it rather than retry forever.
        }
        pending = pending.filter((p) => p !== next);
      }
    } finally {
      if (pending.length === 0) stop();
      await save();
      notify();
    }
    return sent;
  })().finally(() => {
    flushing = null;
  });
  return flushing;
}

async function enqueue(item: PendingScore): Promise<"sent" | "queued"> {
  await load();
  // A newer value for the same hole replaces any waiting one.
  pending = pending.filter((p) => pendingKey(p) !== pendingKey(item));
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
    await send(item);
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

/**
 * Sends a score now; with no connection it's kept and sent later. Resolves
 * "sent" or "queued". Throws only when the database refused it.
 */
export function sendScore(roundId: number, playerId: number, hole: number, strokes: number | null, clear = false): Promise<"sent" | "queued"> {
  return enqueue({ kind: "score", roundId, playerId, hole, strokes, clear, at: Date.now() });
}

/** Scramble: whose drive was used on a hole (null clears it). Same rules as a score. */
export function sendDrive(roundId: number, hole: number, position: number | null): Promise<"sent" | "queued"> {
  return enqueue({ kind: "drive", roundId, playerId: 0, hole, strokes: position, clear: position == null, at: Date.now() });
}

/** Scores and drives waiting for this round, to lay over what the server has. */
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

// Start sending anything left from last time as soon as the app opens.
void load();
