// Plus handicaps at exactly .5 round towards zero (0192, claude/whs-handicaps.md).
//
// R&A Rules of Handicapping, Appendix C: a plus handicap moves "up towards
// zero including rounding" — +2.5 (stored −2.5) → +2 (−2). Postgres round()
// on numeric rounds halves away from zero (−2.5 → −3); the app's
// live-scoring.ts roundHalfUp gives −2. These keep the handicap indicator's
// SQL on the app's side.

import { describe, it, expect, afterAll } from "vitest";
import { pool, closePool } from "./harness";

afterAll(closePool);

describe("plus .5 rounds towards zero (0192)", () => {
  it("the indicator's course handicap is half-up, not round()", async () => {
    const { rows } = await pool.query<{ def: string }>(
      "select pg_get_functiondef('public.handicap_differentials_of(uuid)'::regprocedure) as def"
    );
    expect(rows[0].def).toContain("floor(r.idx * r.slope / 113.0 + (r.course_rating - r.par) + 0.5)");
    expect(rows[0].def).not.toContain("round(r.idx * r.slope / 113.0");
  });

  it("half-up gives the R&A figures for plus and ordinary handicaps", async () => {
    const { rows } = await pool.query<{ x: string; r: number }>(
      "select x::text, floor(x + 0.5)::int as r from unnest(array[-2.5, -1.5, -0.5, 2.5, 18.4, 18.5]::numeric[]) as x"
    );
    expect(rows.map((row) => row.r)).toEqual([-2, -1, 0, 3, 18, 19]);
  });
});
