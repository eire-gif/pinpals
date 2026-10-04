import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  SHARED_ROUND_MAX_MEDIA,
  buildSharedRound,
  duplicateRoundPosts,
  scoreLine,
  visibleParticipants,
  sharedRoundKey,
  type SharedRoundPostInput,
} from "./shared-round";

const teeTime = { id: 41, clubId: 3, clubName: "Portmarnock Golf Club", playDate: "2026-10-02", hostId: "host" };
const players = [
  { memberId: "host", name: "Ciarán Byrne" },
  { memberId: "aoife", name: "Aoife Kelly" },
  { memberId: "dara", name: "Dara Walsh" },
];
const photo = (path: string) => ({ path, width: 1200, height: 1500 });
const round = (id: number, authorId: string, createdAt: string, details: Record<string, unknown>, photos: string[] = []): SharedRoundPostInput => ({
  id,
  authorId,
  kind: "round",
  details: { tee_time_id: 41, holes: 18, ...details },
  createdAt,
  photos: photos.map(photo),
});

describe("shared-round.ts", () => {
  it("is byte-identical in the website and the app", () => {
    const site = readFileSync(join(process.cwd(), "src/lib/shared-round.ts"), "utf8");
    const app = readFileSync(join(process.cwd(), "mobile/src/lib/shared-round.ts"), "utf8");
    expect(app).toBe(site);
  });
});

describe("sharedRoundKey", () => {
  it("is the tee time on a round post, and nothing else", () => {
    expect(sharedRoundKey("round", { score: 78, tee_time_id: 41 })).toBe("tee:41");
    expect(sharedRoundKey("round", { score: 78 })).toBeNull();
    expect(sharedRoundKey("hole", { tee_time_id: 41 })).toBeNull();
    expect(sharedRoundKey("round", { tee_time_id: "41" })).toBeNull();
    expect(sharedRoundKey("round", { tee_time_id: 0 })).toBeNull();
    expect(sharedRoundKey("round", null)).toBeNull();
  });
});

describe("buildSharedRound", () => {
  it("before anyone shares: the players, no scores, no thread", () => {
    const r = buildSharedRound({ teeTime, players, posts: [] });
    expect(r.key).toBe("tee:41");
    expect(r.course).toEqual({ id: 3, name: "Portmarnock Golf Club" });
    expect(r.participants.map((p) => [p.name, p.role, p.score])).toEqual([
      ["Ciarán Byrne", "host", null],
      ["Aoife Kelly", "player", null],
      ["Dara Walsh", "player", null],
    ]);
    expect(r.threadPostId).toBeNull();
    expect(r.media).toEqual([]);
    expect(r.shotMaps).toEqual([]);
  });

  it("folds each player's post into one round: scores, media, one thread", () => {
    const r = buildSharedRound({
      teeTime,
      players,
      posts: [
        round(12, "aoife", "2026-10-02T19:00:00Z", { score: 84, course_par: 72 }, ["aoife/a.jpg"]),
        round(10, "host", "2026-10-02T18:00:00Z", { score: 78, course_par: 72 }, ["host/1.jpg", "host/2.jpg"]),
      ],
    });
    expect(r.threadPostId).toBe(10);
    expect(r.postIds).toEqual([10, 12]);
    expect(r.participants.find((p) => p.memberId === "host")!.score).toEqual({ score: 78, holes: 18, coursePar: 72, vsPar: 6, postId: 10 });
    expect(r.participants.find((p) => p.memberId === "dara")!.score).toBeNull();
    expect(r.media.map((m) => [m.path, m.contributorId])).toEqual([
      ["host/1.jpg", "host"],
      ["host/2.jpg", "host"],
      ["aoife/a.jpg", "aoife"],
    ]);
    expect(scoreLine(r)).toBe("Ciarán 78 (+6) · Aoife 84 (+12)");
  });

  it("ignores posts for another round and posts by someone who didn't play", () => {
    const r = buildSharedRound({
      teeTime,
      players,
      posts: [
        { ...round(20, "aoife", "2026-10-02T18:00:00Z", { score: 80 }), details: { tee_time_id: 99, score: 80 } },
        round(21, "stranger", "2026-10-02T17:00:00Z", { score: 70 }, ["stranger/x.jpg"]),
        { ...round(22, "dara", "2026-10-02T17:30:00Z", {}), kind: "hole" },
      ],
    });
    expect(r.postIds).toEqual([]);
    expect(r.media).toEqual([]);
    expect(r.participants.some((p) => p.memberId === "stranger")).toBe(false);
  });

  it("a later post corrects a player's score; the thread stays on the first", () => {
    const r = buildSharedRound({
      teeTime,
      players,
      posts: [
        round(30, "host", "2026-10-02T18:00:00Z", { score: 79 }),
        round(31, "host", "2026-10-03T09:00:00Z", { score: 78 }),
      ],
    });
    expect(r.participants[0].score!.score).toBe(78);
    expect(r.participants[0].score!.vsPar).toBeNull();
    expect(r.threadPostId).toBe(30);
  });

  it("keeps each photo once and caps the album", () => {
    const many = Array.from({ length: 30 }, (_, i) => `host/${i}.jpg`);
    const r = buildSharedRound({
      teeTime,
      players,
      posts: [
        round(40, "host", "2026-10-02T18:00:00Z", { score: 78 }, ["same.jpg", ...many]),
        round(41, "aoife", "2026-10-02T19:00:00Z", { score: 84 }, ["same.jpg"]),
      ],
    });
    expect(r.media.length).toBe(SHARED_ROUND_MAX_MEDIA);
    expect(r.media.filter((m) => m.path === "same.jpg")).toHaveLength(1);
    expect(r.media[0].contributorId).toBe("host");
  });

  it("9 holes are 9 holes", () => {
    const r = buildSharedRound({ teeTime, players, posts: [round(50, "dara", "2026-10-02T18:00:00Z", { score: 41, holes: 9 })] });
    expect(r.participants.find((p) => p.memberId === "dara")!.score!.holes).toBe(9);
  });
});

describe("visibleParticipants", () => {
  const r = buildSharedRound({
    teeTime,
    players,
    posts: [
      round(60, "host", "2026-10-02T18:00:00Z", { score: 78 }),
      { ...round(61, "aoife", "2026-10-02T19:00:00Z", {}, ["aoife/a.jpg"]) },
    ],
  });

  it("players see the whole fourball", () => {
    expect(visibleParticipants(r, "dara").map((p) => p.memberId)).toEqual(["host", "aoife", "dara"]);
  });

  it("everyone else sees only those who shared a score or a photo", () => {
    expect(visibleParticipants(r, "someone").map((p) => p.memberId)).toEqual(["host", "aoife"]);
    expect(visibleParticipants(r, null).map((p) => p.memberId)).toEqual(["host", "aoife"]);
  });
});

describe("duplicateRoundPosts", () => {
  it("maps every later post of a round to the first, within the page", () => {
    const posts = [
      round(3, "dara", "2026-10-02T20:00:00Z", { score: 90 }),
      { id: 4, kind: "general", details: null, createdAt: "2026-10-02T19:30:00Z" },
      round(2, "aoife", "2026-10-02T19:00:00Z", { score: 84 }),
      round(1, "host", "2026-10-02T18:00:00Z", { score: 78 }),
      { ...round(5, "host", "2026-10-02T21:00:00Z", { score: 80 }), details: { tee_time_id: 7, score: 80 } },
    ];
    expect([...duplicateRoundPosts(posts).entries()].sort()).toEqual([
      [2, 1],
      [3, 1],
    ]);
  });
});
