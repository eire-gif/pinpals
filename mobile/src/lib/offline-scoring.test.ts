import { describe, expect, it, vi } from "vitest";

import { chunks, fromStored, safeKey, toStored } from "./phone-store-rules";
import { isNetworkError, mergePending, overlayPending, pendingKey, withinTime, type PendingScore } from "./score-queue-rules";

const p = (over: Partial<PendingScore>): PendingScore => ({ roundId: 1, playerId: 10, hole: 1, strokes: 4, clear: false, at: 1, ...over });

describe("stored JSON", () => {
  it("keeps a round's nested Maps", () => {
    const round = { scores: new Map([[10, new Map([[1, 4], [2, null]])]]), drives: new Map([[3, 2]]), name: "Portmarnock" };
    const back = fromStored<typeof round>(toStored(round));
    expect(back.scores.get(10)?.get(1)).toBe(4);
    expect(back.scores.get(10)?.has(2)).toBe(true);
    expect(back.drives.get(3)).toBe(2);
    expect(back.name).toBe("Portmarnock");
  });

  it("splits long values into pieces that join back up", () => {
    const text = "x".repeat(4000);
    const parts = chunks(text);
    expect(parts.length).toBe(3);
    expect(parts.every((c) => c.length <= 1800)).toBe(true);
    expect(parts.join("")).toBe(text);
    expect(chunks("")).toEqual([""]);
  });

  it("makes keys SecureStore accepts", () => {
    expect(safeKey("round-12")).toBe("round-12");
    expect(safeKey("a b/c")).toBe("a_b_c");
  });
});

describe("waiting scores", () => {
  it("keeps one value per player and hole, and drives apart from scores", () => {
    expect(pendingKey(p({}))).not.toBe(pendingKey(p({ kind: "drive", playerId: 0 })));
    const merged = mergePending([p({ strokes: 5, at: 1 }), p({ hole: 2, at: 2 })], [p({ strokes: 4, at: 3 })]);
    expect(merged.map((m) => [m.hole, m.strokes])).toEqual([
      [2, 4],
      [1, 4],
    ]);
  });

  it("lays waiting scores and drives over the server's card", () => {
    const data = { scores: new Map([[10, new Map([[1, 6]])]]), drives: new Map([[1, 1]]) };
    const shown = overlayPending(data, [
      p({ hole: 1, strokes: 5, at: 1 }),
      p({ hole: 2, strokes: 3, at: 2 }),
      p({ playerId: 11, hole: 1, clear: true, strokes: null, at: 3 }),
      p({ kind: "drive", playerId: 0, hole: 2, strokes: 3, at: 4 }),
      p({ kind: "drive", playerId: 0, hole: 1, strokes: null, clear: true, at: 5 }),
    ]);
    expect(shown.scores.get(10)?.get(1)).toBe(5);
    expect(shown.scores.get(10)?.get(2)).toBe(3);
    expect(shown.scores.get(11)?.has(1)).toBe(false);
    expect(shown.drives.get(2)).toBe(3);
    expect(shown.drives.has(1)).toBe(false);
    // The server's copy is left alone.
    expect(data.scores.get(10)?.get(1)).toBe(6);
  });
});

describe("withinTime", () => {
  it("gives up on a hanging request the way a lost connection does", async () => {
    vi.useFakeTimers();
    const hang = new Promise(() => {});
    const raced = withinTime(hang, 10_000).catch((e) => e);
    vi.advanceTimersByTime(10_000);
    const err = await raced;
    expect(isNetworkError(err)).toBe(true);
    vi.useRealTimers();
  });

  it("passes a quick answer, and a database refusal, straight through", async () => {
    await expect(withinTime(Promise.resolve(3), 1000)).resolves.toBe(3);
    const refused = await withinTime(Promise.reject({ code: "P0001", message: "finished" }), 1000).catch((e) => e);
    expect(isNetworkError(refused)).toBe(false);
  });
});
