import { loadLiveRound, type LiveRoundData } from "@/lib/live-rounds";
import { getStored, removeStored, setStored } from "@/lib/phone-store";
import { isNetworkError, overlayPending, withinTime } from "@/lib/score-queue-rules";
import { pendingFor } from "@/lib/score-queue";

/**
 * The last copy of a live round, kept on the phone (Oct 2026,
 * claude/offline-scoring.md), so that with no signal at all — the app
 * closed on the 6th and reopened in a dip on the 7th — the round still
 * opens, shows everyone's card and takes scores. Scores entered then wait
 * in score-queue.ts and send themselves when signal is back.
 *
 * Saved every time the round loads from the server while it's live. The
 * three most recent rounds are kept; older copies are deleted.
 */

const INDEX = "offline-rounds";
const KEEP = 3;

type IndexEntry = { id: number; playedOn: string; status: "live" | "finished"; savedAt: number };

const roundKey = (id: number) => `round-${id}`;

async function index(): Promise<IndexEntry[]> {
  return (await getStored<IndexEntry[]>(INDEX)) ?? [];
}

export async function saveRoundCopy(data: LiveRoundData): Promise<void> {
  const entry: IndexEntry = { id: data.round.id, playedOn: data.round.playedOn, status: data.round.status, savedAt: Date.now() };
  await setStored(roundKey(entry.id), data);
  const list = [entry, ...(await index()).filter((e) => e.id !== entry.id)];
  for (const old of list.slice(KEEP)) await removeStored(roundKey(old.id));
  await setStored(INDEX, list.slice(0, KEEP));
}

export async function roundCopy(id: number): Promise<LiveRoundData | null> {
  return getStored<LiveRoundData>(roundKey(id));
}

/** A finished or deleted round needs no copy. */
export async function forgetRound(id: number): Promise<void> {
  await removeStored(roundKey(id));
  await setStored(
    INDEX,
    (await index()).filter((e) => e.id !== id)
  );
}

/**
 * The round, from the server when there's signal (and a copy saved while
 * it's live), or the phone's copy when there isn't. Either way with the
 * scores still waiting on this phone laid over it. `fromPhone` says which.
 * Throws when the server refused it, or there's no signal and no copy.
 */
export async function loadRoundAnyway(id: number): Promise<{ data: LiveRoundData | null; fromPhone: boolean }> {
  let data: LiveRoundData | null;
  let fromPhone = false;
  try {
    // On one bar of signal, don't sit on a spinner: after a few seconds the
    // phone's copy opens instead (if there is one), and the next refresh
    // tries the server again.
    data = await withinTime(loadLiveRound(id), (await roundCopy(id)) ? 8_000 : 30_000);
    if (data?.round.status === "live") void saveRoundCopy(data);
    else void forgetRound(id);
  } catch (e) {
    if (!isNetworkError(e)) throw e;
    data = await roundCopy(id);
    if (!data) throw e;
    fromPhone = true;
  }
  if (!data) return { data, fromPhone };
  return { data: overlayPending(data, await pendingFor(id)), fromPhone };
}

/** The live round this phone last had open, played today or yesterday — for the MY ROUND pill with no signal. */
export async function lastLiveRoundOnPhone(today: string, yesterday: string): Promise<number | null> {
  const hit = (await index()).find((e) => e.status === "live" && (e.playedOn === today || e.playedOn === yesterday));
  return hit?.id ?? null;
}

// ---- The course and its hole maps, for the hole map with no signal ----

const courseKey = (clubId: number) => `course-${clubId}`;

export async function saveCourseCopy(clubId: number, value: { course: unknown; layouts: unknown }): Promise<void> {
  await setStored(courseKey(clubId), value);
}

export async function courseCopy<C, L>(clubId: number): Promise<{ course: C; layouts: L } | null> {
  return getStored<{ course: C; layouts: L }>(courseKey(clubId));
}
