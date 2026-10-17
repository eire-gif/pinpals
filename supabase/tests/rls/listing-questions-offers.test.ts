// 0162_listing_questions_offers.sql — the public questions & offers thread
// under every used-gear listing: who can post what, the seller's answers,
// one open offer per buyer, blocks, under-18s, and offers closing when the
// listing comes off sale.
import { describe, it, expect, afterAll } from "vitest";
import type { PoolClient } from "pg";
import { withRole, expectRejected, setIdentity, closePool } from "./harness";
import { USERS } from "./fixtures";
import { fixtureIds } from "./ids";

const ids = fixtureIds();
const LISTING = () => ids.listings.active; // seller1's, on sale
const SELLER = USERS.seller1;

afterAll(closePool);

async function rejects(c: PoolClient, sql: string, params: unknown[], pattern?: RegExp): Promise<void> {
  await c.query("savepoint attempt");
  await expectRejected(c.query(sql, params), pattern);
  await c.query("rollback to savepoint attempt");
}

async function asService<T>(c: PoolClient, fn: () => Promise<T>): Promise<T> {
  await c.query("set local role service_role");
  try {
    return await fn();
  } finally {
    await c.query("set local role authenticated");
  }
}

const offer = async (c: PoolClient, cents: number, listing = LISTING()) =>
  (await c.query("select public.post_listing_offer($1, $2) as id", [listing, cents])).rows[0].id as string;
const question = async (c: PoolClient, body: string, listing = LISTING()) =>
  (await c.query("select public.post_listing_question($1, $2) as id", [listing, body])).rows[0].id as string;
const thread = async (c: PoolClient, listing = LISTING()) =>
  (await c.query("select * from public.listing_public_posts($1)", [listing])).rows;

describe("asking and offering", () => {
  it("a member asks a question and posts an offer, and everyone — even signed out — sees both", async () => {
    await withRole("authenticated", USERS.buyer1, async (c) => {
      await question(c, "Is the face clean?");
      await offer(c, 23000);
      await c.query("set local role anon");
      await setIdentity(c, "");
      const rows = await thread(c);
      expect(rows.map((r) => r.kind)).toEqual(["question", "offer"]);
      expect(rows[1].amount_cents).toBe(23000);
      expect(rows[1].status).toBe("open");
      expect(rows[0].is_seller).toBe(false);
      expect(rows[0].author_name).toMatch(/\S/);
    });
  });

  it("nobody writes the table directly", async () => {
    await withRole("authenticated", USERS.buyer1, async (c) => {
      await rejects(
        c,
        "insert into public.listing_posts (listing_id, author_id, kind, body) values ($1, $2, 'question', 'hi')",
        [LISTING(), USERS.buyer1],
      );
      const id = await question(c, "Grips original?");
      await rejects(c, "update public.listing_posts set body = 'changed' where id = $1", [id]);
      await rejects(c, "delete from public.listing_posts where id = $1", [id]);
      const after = await c.query("select body from public.listing_posts where id = $1", [id]);
      expect(after.rows[0].body).toBe("Grips original?");
    });
  });

  it("the seller can't make an offer on, or ask about, their own listing", async () => {
    await withRole("authenticated", SELLER, async (c) => {
      await rejects(c, "select public.post_listing_offer($1, 20000)", [LISTING()], /own listing/);
      await rejects(c, "select public.post_listing_question($1, 'hello')", [LISTING()], /your listing/);
    });
  });

  it("a new offer replaces the buyer's earlier open one", async () => {
    await withRole("authenticated", USERS.buyer1, async (c) => {
      const first = await offer(c, 20000);
      const second = await offer(c, 21000);
      const rows = await thread(c);
      expect(rows.find((r) => r.id === first)?.status).toBe("withdrawn");
      expect(rows.find((r) => r.id === second)?.status).toBe("open");
    });
  });

  it("offers below €1 or absurdly large are refused", async () => {
    await withRole("authenticated", USERS.buyer1, async (c) => {
      await rejects(c, "select public.post_listing_offer($1, 50)", [LISTING()], /€1/);
      await rejects(c, "select public.post_listing_offer($1, 20000000)", [LISTING()]);
    });
  });

  it("nothing can be posted on a listing that isn't on sale", async () => {
    await withRole("authenticated", USERS.buyer1, async (c) => {
      await rejects(c, "select public.post_listing_offer($1, 2000)", [ids.listings.sold]);
      await rejects(c, "select public.post_listing_question($1, 'still there?')", [ids.listings.draft], /couldn't be found/);
    });
  });

  it("signed-out visitors can't post", async () => {
    await withRole("anon", null, async (c) => {
      await rejects(c, "select public.post_listing_question($1, 'hi')", [LISTING()]);
    });
  });
});

describe("the seller's answers", () => {
  it("accept, decline and counter, each visible to everyone, and the buyer is told", async () => {
    await withRole("authenticated", USERS.buyer1, async (c) => {
      const a = await offer(c, 20000);
      await setIdentity(c, USERS.buyer2);
      const b = await offer(c, 15000);
      await setIdentity(c, SELLER);
      await c.query("select public.answer_listing_offer($1, 'counter', 23500, 'Could do €235 this week')", [a]);
      await c.query("select public.answer_listing_offer($1, 'decline')", [b]);
      const rows = await thread(c);
      const byId = new Map(rows.map((r) => [r.id, r]));
      expect(byId.get(a)?.status).toBe("countered");
      expect(byId.get(a)?.counter_cents).toBe(23500);
      expect(byId.get(b)?.status).toBe("declined");
      const reply = rows.find((r) => r.kind === "reply" && r.parent_id === a);
      expect(reply?.body).toBe("Could do €235 this week");
      expect(reply?.is_seller).toBe(true);

      await setIdentity(c, USERS.buyer1);
      const alerts = await c.query(
        "select title from public.notifications where user_id = $1 and type = 'listing_offer_answered'",
        [USERS.buyer1],
      );
      expect(alerts.rows.some((r) => /would take €235/.test(r.title))).toBe(true);
    });
  });

  it("a counter must be above the offer, and only the seller answers, once", async () => {
    await withRole("authenticated", USERS.buyer1, async (c) => {
      const a = await offer(c, 20000);
      await rejects(c, "select public.answer_listing_offer($1, 'accept')", [a], /Only the seller/);
      await setIdentity(c, SELLER);
      await rejects(c, "select public.answer_listing_offer($1, 'counter', 19000)", [a], /more than they offered/);
      await c.query("select public.answer_listing_offer($1, 'accept')", [a]);
      await rejects(c, "select public.answer_listing_offer($1, 'decline')", [a], /already been answered/);
    });
  });

  it("the seller is told about questions and offers", async () => {
    await withRole("authenticated", USERS.buyer2, async (c) => {
      await question(c, "Left-handed?");
      await offer(c, 18000);
      await setIdentity(c, SELLER);
      const r = await c.query(
        "select type from public.notifications where user_id = $1 and type in ('listing_question', 'listing_offer')",
        [SELLER],
      );
      expect(r.rows.map((x) => x.type).sort()).toEqual(["listing_offer", "listing_question"]);
    });
  });
});

describe("replies", () => {
  it("the seller and the asker can reply; a third member can't", async () => {
    await withRole("authenticated", USERS.buyer1, async (c) => {
      const q = await question(c, "Any marks on the crown?");
      await setIdentity(c, SELLER);
      await c.query("select public.reply_to_listing_post($1, 'None at all')", [q]);
      await setIdentity(c, USERS.buyer1);
      await c.query("select public.reply_to_listing_post($1, 'Great, thanks')", [q]);
      await setIdentity(c, USERS.buyer2);
      await rejects(c, "select public.reply_to_listing_post($1, 'me too')", [q], /Only the seller/);
      const replies = (await thread(c)).filter((r) => r.parent_id === q);
      expect(replies).toHaveLength(2);
    });
  });

  it("you can take down your own question, not someone else's", async () => {
    await withRole("authenticated", USERS.buyer1, async (c) => {
      const q = await question(c, "Typo here");
      await setIdentity(c, USERS.buyer2);
      await rejects(c, "select public.remove_listing_post($1)", [q]);
      await setIdentity(c, USERS.buyer1);
      await c.query("select public.remove_listing_post($1)", [q]);
      expect((await thread(c)).some((r) => r.id === q)).toBe(false);
    });
  });

  it("a buyer can withdraw their own offer", async () => {
    await withRole("authenticated", USERS.buyer1, async (c) => {
      const a = await offer(c, 20000);
      await setIdentity(c, USERS.buyer2);
      await rejects(c, "select public.withdraw_listing_offer($1)", [a]);
      await setIdentity(c, USERS.buyer1);
      await c.query("select public.withdraw_listing_offer($1)", [a]);
      expect((await thread(c)).find((r) => r.id === a)?.status).toBe("withdrawn");
    });
  });
});

describe("blocks, under-18s and coming off sale", () => {
  it("a member the seller has blocked can't post", async () => {
    await withRole("authenticated", SELLER, async (c) => {
      await asService(c, () =>
        c.query("insert into public.blocked_users (blocker_id, blocked_id) values ($1, $2)", [SELLER, USERS.buyer2]),
      );
      await setIdentity(c, USERS.buyer2);
      await rejects(c, "select public.post_listing_question($1, 'hello')", [LISTING()], /can't post/);
    });
  });

  it("members under 18 can read but not post", async () => {
    await withRole("authenticated", USERS.buyer2, async (c) => {
      const dob = new Date();
      dob.setUTCFullYear(dob.getUTCFullYear() - 16);
      await asService(c, () =>
        c.query(
          `insert into public.member_birthdates (user_id, date_of_birth) values ($1, $2)
           on conflict (user_id) do update set date_of_birth = excluded.date_of_birth`,
          [USERS.buyer2, dob.toISOString().slice(0, 10)],
        ),
      );
      await rejects(c, "select public.post_listing_offer($1, 2000)", [LISTING()], /under 18/);
      await thread(c);
    });
  });

  it("open and countered offers close when the listing is marked sold", async () => {
    await withRole("authenticated", USERS.buyer1, async (c) => {
      const a = await offer(c, 20000);
      await setIdentity(c, USERS.buyer2);
      const b = await offer(c, 21000);
      await setIdentity(c, SELLER);
      await c.query("select public.answer_listing_offer($1, 'counter', 22000)", [b]);
      await c.query("select public.mark_listing_sold($1)", [LISTING()]);
      const r = await c.query("select id, status from public.listing_posts where id in ($1, $2)", [a, b]);
      expect(r.rows.every((x) => x.status === "closed")).toBe(true);
    });
  });
});
