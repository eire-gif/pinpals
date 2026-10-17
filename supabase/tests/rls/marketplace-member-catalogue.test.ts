// 0164_marketplace_member_catalogue.sql — the catalogue learns from sellers.
//
// What must hold:
//   - what a seller types (a model behind a known brand, a brand behind
//     "Other") is counted once per seller, however it's spelled
//   - the next seller is offered it only once 3 different sellers typed it,
//     and only until staff decide; nobody sees who typed it
//   - at 5 sellers it's learned by itself — a model, or a brand for that
//     category — and the ads that used it move under it
//   - members can't read or write the votes or decisions; anything staff
//     hide is never learned again
import { describe, it, expect, afterAll } from "vitest";
import type { PoolClient } from "pg";
import { withRole, closePool } from "./harness";
import { USERS } from "./fixtures";

afterAll(closePool);

async function asService<T>(c: PoolClient, fn: () => Promise<T>): Promise<T> {
  await c.query("set local role service_role");
  try {
    return await fn();
  } finally {
    await c.query("set local role authenticated");
  }
}

async function rejects(c: PoolClient, sql: string, params: unknown[], pattern?: RegExp): Promise<void> {
  await c.query("savepoint attempt");
  let message: string | null = null;
  try {
    await c.query(sql, params);
  } catch (err) {
    message = err instanceof Error ? err.message : String(err);
  }
  await c.query("rollback to savepoint attempt");
  if (message == null) throw new Error(`Expected to be rejected: ${sql}`);
  if (pattern && !pattern.test(message)) throw new Error(`Rejected with "${message}", expected ${pattern}`);
}

async function list(c: PoolClient, seller: string, fields: { brand: string; model?: string | null; brandOther?: string | null; category?: string }): Promise<string> {
  return asService(c, async () => {
    const { rows } = await c.query<{ id: string }>(
      `insert into public.listings (seller_id, title, description, price_eur, price_cents, category, condition, county, status, sale_type,
                                    delivery_options, collection_notes, brand, brand_other, model)
       values ($1, 'x', 'x', 100, 10000, $2, 'Good', 'Dublin', 'active', 'fixed_price', '{collection}', 'At the club', $3, $4, $5)
       returning id`,
      [seller, fields.category ?? "Drivers", fields.brand, fields.brandOther ?? null, fields.model ?? null],
    );
    return rows[0].id;
  });
}

const suggestions = async (c: PoolClient, category: string, brand: string | null) =>
  (await c.query<{ label: string; sellers: number }>("select * from public.marketplace_member_suggestions($1, $2)", [category, brand])).rows;

describe("models sellers type", () => {
  it("are offered once 3 sellers typed them, and not before", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      await list(c, USERS.seller1, { brand: "taylormade", model: "Qi4D Tour" });
      await list(c, USERS.seller1, { brand: "taylormade", model: "qi4d-tour" }); // same seller again: still one
      await list(c, USERS.seller2, { brand: "taylormade", model: "QI 4D TOUR" });
      expect((await suggestions(c, "Drivers", "taylormade")).find((s) => s.label.toLowerCase().includes("4d"))).toBeUndefined();

      await list(c, USERS.buyer1, { brand: "taylormade", model: "Qi4D Tour" });
      // Offered once, in one of the spellings sellers used.
      const s = (await suggestions(c, "Drivers", "taylormade")).filter((x) => x.label.replace(/\W/g, "").toLowerCase() === "qi4dtour");
      expect(s).toHaveLength(1);
      expect(s[0].sellers).toBe(3);

      // Something already in the catalogue is never suggested.
      for (const who of [USERS.seller1, USERS.seller2, USERS.buyer1]) await list(c, who, { brand: "taylormade", model: "Qi10" });
      expect((await suggestions(c, "Drivers", "taylormade")).some((x) => x.label === "Qi10")).toBe(false);
    });
  });

  it("are learned at 5 sellers, and the ads move under the new model", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      const five = [USERS.seller1, USERS.seller2, USERS.buyer1, USERS.buyer2, USERS.moderator];
      const ids: string[] = [];
      for (const who of five.slice(0, 4)) ids.push(await list(c, who, { brand: "ping", model: "g450 max" }));
      const before = await asService(c, () => c.query("select count(*)::int n from public.marketplace_models where brand_id = 'ping' and family ilike 'g450%'"));
      expect(before.rows[0].n).toBe(0);
      ids.push(await list(c, five[4], { brand: "ping", model: "G450 Max" }));

      const model = (await asService(c, () => c.query("select id, family, learned from public.marketplace_models where brand_id = 'ping' and category = 'Drivers' and family = 'G450 Max'"))).rows[0];
      expect(model).toMatchObject({ family: "G450 Max", learned: true });
      const linked = await asService(c, () => c.query("select count(*)::int n from public.listings where id = any($1::bigint[]) and model_id = $2", [ids, model.id]));
      expect(linked.rows[0].n).toBe(5);
      // It's in the catalogue now, so no longer "suggested".
      expect((await suggestions(c, "Drivers", "ping")).some((x) => x.label.toLowerCase() === "g450 max")).toBe(false);

      await rejects(c, "select * from public.marketplace_catalogue_votes", [], /permission denied/);
      await rejects(c, "insert into public.marketplace_catalogue_decisions (kind, brand_id, category, norm_key, decision) values ('model', 'ping', 'Drivers', 'x', 'dismissed')", [], /permission denied/);
      await rejects(c, "select public.marketplace_learn('model', 'ping', 'Drivers', 'g450max')", [], /permission denied/);
    });
  });

  it("aren't learned again once staff hide them", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      await asService(c, () =>
        c.query("insert into public.marketplace_catalogue_decisions (kind, brand_id, category, norm_key, decision) values ('model', 'cobra', 'Drivers', 'rudeword', 'dismissed')"),
      );
      for (const who of [USERS.seller1, USERS.seller2, USERS.buyer1, USERS.buyer2, USERS.moderator]) await list(c, who, { brand: "cobra", model: "Rude Word" });
      const n = await asService(c, () => c.query("select count(*)::int n from public.marketplace_models where brand_id = 'cobra' and family ilike 'rude%'"));
      expect(n.rows[0].n).toBe(0);
      expect((await suggestions(c, "Drivers", "cobra")).length).toBe(0);
    });
  });
});

describe("brands sellers type", () => {
  it("are offered for the category once 3 sellers typed them, and staff can move the ads", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      for (const [who, spelling] of [[USERS.seller1, "Kaiser Golf"], [USERS.seller2, "kaiser-golf"], [USERS.buyer2, "KAISER GOLF"]] as const) {
        await list(c, who, { brand: "other", brandOther: spelling, category: "Irons" });
      }
      await c.query("set local role anon");
      const s = await suggestions(c, "Irons", null);
      expect(s.find((x) => x.label.replace(/\W/g, "").toLowerCase() === "kaisergolf")?.sellers).toBe(3);
      // A brand we already have is never suggested, however it's typed.
      for (const who of [USERS.seller1, USERS.seller2, USERS.buyer2]) {
        await c.query("set local role authenticated");
        await list(c, who, { brand: "other", brandOther: "Sub-70", category: "Irons" });
      }
      await c.query("set local role anon");
      expect((await suggestions(c, "Irons", null)).some((x) => x.label.toLowerCase().startsWith("sub"))).toBe(false);
      await c.query("set local role authenticated");

      await c.query("set local role authenticated");
      const ids: string[] = [];
      for (const who of [USERS.buyer1, USERS.moderator]) ids.push(await list(c, who, { brand: "other", brandOther: "Kaiser Golf", category: "Irons" }));
      const brand = (await asService(c, () => c.query("select id, label, learned, categories from public.marketplace_brands where label = 'Kaiser Golf'"))).rows[0];
      expect(brand).toMatchObject({ id: "kaiser-golf", learned: true, categories: ["Irons"] });
      const moved = await asService(c, () => c.query("select count(*)::int n from public.listings where brand = 'kaiser-golf' and brand_other is null"));
      expect(moved.rows[0].n).toBe(5);
    });
  });
});
