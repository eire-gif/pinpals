/**
 * Where the "invite a friend" card goes in a list (Oct 2026). Pure, so the
 * mobile vitest project can test it.
 *
 * After every `every`th item — but never after the last one, which is where
 * a list's own footer (or nothing) belongs. A list shorter than `every`
 * gets no inline card at all.
 */
export function inviteAfter(index: number, total: number, every: number): boolean {
  if (every < 1) return false;
  return (index + 1) % every === 0 && index < total - 1;
}

/** How often each list carries the card. Members asked for every fourth. */
export const INVITE_EVERY = {
  members: 4,
  connections: 4,
  teeTimes: 5,
  feed: 6,
} as const;
