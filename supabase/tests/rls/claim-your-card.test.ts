// 0198_claim_your_card.sql — a claimed guest card lands in the claimer's
// scorecards, and the sender can count who joined from their cards.
//
// Cast:
//   seller1  plays a round with a guest ("Mark"), sends Mark his card
//   buyer2   is Mark, joins PinPals and claims it
import { describe, it, expect, afterAll } from "vitest";
import type { PoolClient } from "pg";
import { withRole, closePool } from "./harness";
import { USERS } from "./fixtures";

afterAll(closePool);

const ME = USERS.seller1;
const MARK = USERS.buyer2;

async function as(c: PoolClient, userId: string): Promise<void> {
  await c.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
}

const p = (memberId: string | null, name: string) => ({
  member_id: memberId,
  name,
  handicap_index: 12.0,
  course_handicap: 14,
  playing_handicap: 13,
  handicap_estimated: false,
});
const card18 = JSON.stringify(Array.from({ length: 18 }, (_, i) => ({ hole: i + 1, par: 4, stroke_index: i + 1 })));

describe("claiming a guest card", () => {
  it("saves the claimer's own scorecard, and the sender sees one sent, one joined", async () => {
    await withRole("authenticated", ME, async (c) => {
      await as(c, ME);
      const round = (
        await c.query<{ id: string }>("select public.live_round_create($1::jsonb, $2::jsonb, $3::jsonb) as id", [
          JSON.stringify({ course_name: "Portmarnock Golf Club", holes: 18, allowance: 0.95, format: "stableford" }),
          JSON.stringify([p(ME, "Eire"), p(null, "Mark")]),
          card18,
        ])
      ).rows[0].id;
      const players = await c.query<{ id: string; member_id: string | null }>("select id, member_id from public.live_round_players where round_id = $1 order by position", [round]);
      const markSeat = players.rows.find((r) => r.member_id == null)!.id;
      for (let h = 1; h <= 18; h++) await c.query("select public.live_round_set_score($1, $2, $3::smallint, 5::smallint)", [round, markSeat, h]);
      await c.query("select public.live_round_finish($1)", [round]);

      const before = (await c.query("select * from public.my_guest_invite_stats()")).rows[0];
      const token = (await c.query<{ t: string }>("select public.round_guest_invite($1) as t", [markSeat])).rows[0].t;
      expect((await c.query("select * from public.my_guest_invite_stats()")).rows[0]).toEqual({ sent: before.sent + 1, joined: before.joined });

      await as(c, MARK);
      // Mark can't see anyone's counts but his own (none).
      expect((await c.query("select * from public.my_guest_invite_stats()")).rows[0]).toEqual({ sent: 0, joined: 0 });
      await c.query("select public.claim_round_guest($1)", [token]);
      const mine = await c.query<{ id: string; holes: number }>("select id, holes from public.scorecards where member_id = $1 and live_round_id = $2", [MARK, round]);
      expect(mine.rows).toHaveLength(1);
      const strokes = await c.query<{ n: number }>("select count(*)::int as n from public.scorecard_holes where scorecard_id = $1 and strokes = 5", [mine.rows[0].id]);
      expect(strokes.rows[0].n).toBe(18);

      await as(c, ME);
      expect((await c.query("select * from public.my_guest_invite_stats()")).rows[0]).toEqual({ sent: before.sent + 1, joined: before.joined + 1 });
    });
  });
});
