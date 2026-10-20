// 0182_scorecard_weather.sql — the weather a round was played in, on its cards.
//
// What must hold:
//   - members can't write the weather themselves; the site's job (service
//     role) does
//   - whoever may see a card sees its weather, nobody else
//   - a new card starts waiting; changing its course or date by hand sends it
//     back to waiting; changing its scores doesn't
//   - setting the weather doesn't void a certification (0128's hash)
import { describe, it, expect, afterAll } from "vitest";
import type { PoolClient } from "pg";
import { withRole, closePool } from "./harness";
import { USERS } from "./fixtures";

afterAll(closePool);

const ME = USERS.seller1;
const STRANGER = USERS.buyer2;

async function as(c: PoolClient, userId: string): Promise<void> {
  await c.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
}

async function asService<T>(c: PoolClient, fn: () => Promise<T>): Promise<T> {
  await c.query("set local role service_role");
  try {
    return await fn();
  } finally {
    await c.query("set local role authenticated");
  }
}

async function rejects(c: PoolClient, sql: string, params: unknown[]): Promise<void> {
  await c.query("savepoint attempt");
  let failed = false;
  try {
    await c.query(sql, params);
  } catch {
    failed = true;
  }
  await c.query("rollback to savepoint attempt");
  if (!failed) throw new Error(`Expected to be rejected: ${sql}`);
}

const card = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ course_name: "Portmarnock Golf Club", holes: 18, played_on: "2026-10-04", par_total: 72, visibility: "private", ...over });
const holes = (strokes = 5) => JSON.stringify(Array.from({ length: 18 }, (_, i) => ({ hole: i + 1, par: 4, stroke_index: i + 1, strokes })));
const SAVE = "select public.scorecard_save($1, $2::jsonb, $3::jsonb) as id";

const WEATHER = { v: 1, tempC: 9, windKmh: 35, gustKmh: 56, fromDeg: 270, rainMm: 3, wet: true, kind: "showers", from: "2026-10-04T09:00:00Z", to: "2026-10-04T13:00:00Z", credit: "Apple Weather" };

async function save(c: PoolClient, over: Record<string, unknown> = {}): Promise<string> {
  await as(c, ME);
  const { rows } = await c.query<{ id: string }>(SAVE, [null, card(over), holes()]);
  return rows[0].id;
}

const state = async (c: PoolClient, id: string) =>
  asService(c, async () => (await c.query<{ weather: unknown; checked: boolean }>("select weather, weather_checked_at is not null as checked from public.scorecards where id = $1", [id])).rows[0]);

const fill = (c: PoolClient, id: string) =>
  asService(c, () => c.query("update public.scorecards set weather = $2::jsonb, weather_checked_at = now() where id = $1", [id, JSON.stringify(WEATHER)]));

describe("scorecard weather", () => {
  it("starts waiting, is written by the site's job only, and is read with the card", async () => {
    await withRole("authenticated", ME, async (c) => {
      const id = await save(c);
      expect(await state(c, id)).toEqual({ weather: null, checked: false });

      await as(c, ME);
      await rejects(c, "update public.scorecards set weather = '{}'::jsonb where id = $1", [id]);
      await rejects(c, "update public.scorecards set weather_checked_at = now() where id = $1", [id]);

      await fill(c, id);
      await as(c, ME);
      const { rows } = await c.query<{ weather: { kind: string } }>("select weather from public.scorecards where id = $1", [id]);
      expect(rows[0].weather.kind).toBe("showers");

      // A private card: a stranger sees neither it nor its weather.
      await as(c, STRANGER);
      expect((await c.query("select weather from public.scorecards where id = $1", [id])).rowCount).toBe(0);
      await c.query("set local role anon");
      await rejects(c, "select weather from public.scorecards", []);
    });
  });

  it("goes back to waiting when the course or date changes, not when the scores do", async () => {
    await withRole("authenticated", ME, async (c) => {
      const id = await save(c);
      await fill(c, id);

      await as(c, ME);
      await c.query(SAVE, [id, card(), holes(4)]);
      expect((await state(c, id)).checked).toBe(true);

      await as(c, ME);
      await c.query(SAVE, [id, card({ played_on: "2026-10-03" }), holes(4)]);
      expect(await state(c, id)).toEqual({ weather: null, checked: false });
    });
  });

  it("doesn't change what a certificate covers", async () => {
    await withRole("authenticated", ME, async (c) => {
      const id = await save(c);
      const hash = async () => asService(c, async () => (await c.query<{ h: string }>("select public.scorecard_card_hash($1) as h", [id])).rows[0].h);
      const before = await hash();
      await fill(c, id);
      expect(await hash()).toBe(before);
    });
  });
});
