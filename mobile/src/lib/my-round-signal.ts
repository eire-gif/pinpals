/**
 * "Something about my live round just changed — check again." Raised by the
 * live scoring writes (live-rounds.ts) and heard by the MY ROUND watcher
 * (my-round.ts). A separate file with no imports so live-rounds.ts stays
 * loadable in the plain-Node tests.
 */
type Listener = (minGapMs: number) => void;
const listeners = new Set<Listener>();

export function signalMyRound(minGapMs = 0): void {
  listeners.forEach((l) => l(minGapMs));
}

export function onMyRoundSignal(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
