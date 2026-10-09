import { describe, expect, it } from "vitest";

import { applyCommentReaction, normaliseEmojiCounts, topEmoji } from "./comment-reactions";

describe("comment emoji", () => {
  it("reads counts, dropping anything unknown; old likes are hearts", () => {
    expect(normaliseEmojiCounts({ "😂": 2, "❤️": 1, evil: 9, "🔥": -1 }, 3)).toEqual({ "😂": 2, "❤️": 1 });
    expect(normaliseEmojiCounts(null, 4)).toEqual({ "❤️": 4 });
    expect(normaliseEmojiCounts({}, 0)).toEqual({});
  });

  it("moves a member's reaction", () => {
    const c = { "❤️": 2, "😂": 1 };
    expect(applyCommentReaction(c, null, "👍")).toEqual({ "❤️": 2, "😂": 1, "👍": 1 });
    expect(applyCommentReaction(c, "😂", "🔥")).toEqual({ "❤️": 2, "🔥": 1 });
    expect(applyCommentReaction(c, "❤️", null)).toEqual({ "❤️": 1, "😂": 1 });
    expect(c).toEqual({ "❤️": 2, "😂": 1 });
  });

  it("shows the most used first", () => {
    expect(topEmoji({ "⛳": 1, "😂": 3, "❤️": 3, "👍": 2 })).toEqual(["❤️", "😂", "👍"]);
  });
});
