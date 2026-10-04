// Courses played, bucket lists, course reviews and suggested PinPals — 0093.
//
// Every case seeds and asserts inside ONE withRole transaction (withRole
// always rolls back). Clubs are created as service_role inside that same
// transaction and the role switched back to `authenticated` with
// `set local role`, because members cannot insert clubs.
import { describe, it, expect, afterAll } from "vitest";
import type { PoolClient } from "pg";
import { withRole, setIdentity, expectRejected, expectZeroRows, closePool } from "./harness";
import { USERS } from "./fixtures";

afterAll(closePool);

/** expectRejected inside a savepoint, so one transaction can assert several
 *  refusals in a row (a failed statement otherwise aborts the transaction). */
async function refused(c: PoolClient, sql: string, params: unknown[], pattern?: RegExp) {
  await c.query("savepoint refusal");
  await expectRejected(c.query(sql, params), pattern);
  await c.query("rollback to savepoint refusal");
}

/** Two clubs ~8 km apart (Galway and Bearna) and one ~200 km away (Dublin). */
async function seedClubs(c: PoolClient) {
  await c.query("set local role service_role");
  const r = await c.query(
    `insert into public.clubs (name, slug, country, latitude, longitude)
     values ('Test Galway GC', 'test-galway', 'ireland', 53.259, -9.090),
            ('Test Bearna GC', 'test-bearna', 'ireland', 53.250, -9.205),
            ('Test Dublin GC', 'test-dublin', 'ireland', 53.349, -6.260)
     returning id`,
  );
  await c.query("set local role authenticated");
  const [galway, bearna, dublin] = r.rows.map((x) => String(x.id));
  return { galway, bearna, dublin };
}

async function setHomeClub(c: PoolClient, userId: string, clubId: string | null) {
  await c.query("set local role service_role");
  await c.query("update public.profiles set home_club_id = $2 where id = $1", [userId, clubId]);
  await c.query("set local role authenticated");
}

async function clubRating(c: PoolClient, clubId: string) {
  const r = await c.query("select rating_count, rating_avg, rating_dist from public.clubs where id = $1", [clubId]);
  return r.rows[0] as { rating_count: number; rating_avg: string | null; rating_dist: number[] };
}

describe("member_courses", () => {
  it("a member adds and removes their own rows; others can read them", async () => {
    await withRole("authenticated", USERS.buyer1, async (c) => {
      const { galway } = await seedClubs(c);
      await c.query("insert into public.member_courses (member_id, club_id, kind) values ($1, $2, 'played')", [USERS.buyer1, galway]);
      await c.query("insert into public.member_courses (member_id, club_id, kind) values ($1, $2, 'bucket')", [USERS.buyer1, galway]);

      await setIdentity(c, USERS.buyer2);
      const seen = await c.query("select kind from public.member_courses where member_id = $1 order by kind", [USERS.buyer1]);
      expect(seen.rows.map((r) => r.kind)).toEqual(["bucket", "played"]);

      // Cannot delete someone else's row, or add one in their name.
      expectZeroRows(await c.query("delete from public.member_courses where member_id = $1", [USERS.buyer1]));
      await refused(c, "insert into public.member_courses (member_id, club_id, kind) values ($1, $2, 'played')", [USERS.buyer1, galway]);
    });
  });

  it("is not readable signed out", async () => {
    await withRole("authenticated", USERS.buyer1, async (c) => {
      const { galway } = await seedClubs(c);
      await c.query("insert into public.member_courses (member_id, club_id, kind) values ($1, $2, 'played')", [USERS.buyer1, galway]);
      await c.query("set local role anon");
      // No anon policy: RLS returns nothing rather than raising.
      expectZeroRows(await c.query("select 1 from public.member_courses"));
    });
  });
});

describe("course_reviews", () => {
  it("rolls up onto clubs, and writing one records the course as played", async () => {
    await withRole("authenticated", USERS.buyer1, async (c) => {
      const { galway } = await seedClubs(c);
      await c.query("insert into public.course_reviews (club_id, member_id, rating, body) values ($1, $2, 5, 'Lovely')", [galway, USERS.buyer1]);
      await setIdentity(c, USERS.buyer2);
      await c.query("insert into public.course_reviews (club_id, member_id, rating) values ($1, $2, 4)", [galway, USERS.buyer2]);

      expect(await clubRating(c, galway)).toEqual({ rating_count: 2, rating_avg: "4.5", rating_dist: [0, 0, 0, 1, 1] });

      const played = await c.query("select member_id from public.member_courses where club_id = $1 and kind = 'played' order by member_id", [galway]);
      expect(played.rows.map((r) => r.member_id)).toEqual([USERS.buyer1, USERS.buyer2]);

      // Editing and deleting recompute too.
      await c.query("update public.course_reviews set rating = 2 where member_id = $1 and club_id = $2", [USERS.buyer2, galway]);
      expect((await clubRating(c, galway)).rating_avg).toBe("3.5");
      await c.query("delete from public.course_reviews where member_id = $1 and club_id = $2", [USERS.buyer2, galway]);
      expect(await clubRating(c, galway)).toEqual({ rating_count: 1, rating_avg: "5.0", rating_dist: [0, 0, 0, 0, 1] });
    });
  });

  it("one review per member per course", async () => {
    await withRole("authenticated", USERS.buyer1, async (c) => {
      const { galway } = await seedClubs(c);
      await c.query("insert into public.course_reviews (club_id, member_id, rating) values ($1, $2, 5)", [galway, USERS.buyer1]);
      await expectRejected(
        c.query("insert into public.course_reviews (club_id, member_id, rating) values ($1, $2, 1)", [galway, USERS.buyer1]),
        /duplicate|unique/,
      );
    });
  });

  it("a member cannot review as someone else, edit another's review, or hide their own", async () => {
    await withRole("authenticated", USERS.buyer1, async (c) => {
      const { galway } = await seedClubs(c);
      await refused(c, "insert into public.course_reviews (club_id, member_id, rating) values ($1, $2, 1)", [galway, USERS.buyer2]);
      await c.query("insert into public.course_reviews (club_id, member_id, rating) values ($1, $2, 5)", [galway, USERS.buyer1]);

      // hidden_at is not in the member's column grant.
      await refused(c, "update public.course_reviews set hidden_at = now() where member_id = $1", [USERS.buyer1], /permission denied/);
      // Nor is club_id: a review cannot be moved to another course.
      await refused(c, "update public.course_reviews set club_id = club_id where member_id = $1", [USERS.buyer1], /permission denied/);

      await setIdentity(c, USERS.buyer2);
      expectZeroRows(await c.query("update public.course_reviews set rating = 1 where member_id = $1", [USERS.buyer1]));
      expectZeroRows(await c.query("delete from public.course_reviews where member_id = $1", [USERS.buyer1]));
    });
  });

  it("a hidden review disappears for others and from the average, but not for its author", async () => {
    await withRole("authenticated", USERS.buyer1, async (c) => {
      const { galway } = await seedClubs(c);
      await c.query("insert into public.course_reviews (club_id, member_id, rating) values ($1, $2, 1)", [galway, USERS.buyer1]);
      await c.query("set local role service_role");
      await c.query("update public.course_reviews set hidden_at = now() where member_id = $1", [USERS.buyer1]);
      await c.query("set local role authenticated");

      expect((await clubRating(c, galway)).rating_count).toBe(0);
      const mine = await c.query("select 1 from public.course_reviews where club_id = $1", [galway]);
      expect(mine.rowCount).toBe(1);

      await setIdentity(c, USERS.buyer2);
      const theirs = await c.query("select 1 from public.course_reviews where club_id = $1", [galway]);
      expect(theirs.rowCount).toBe(0);
    });
  });

  it("signed-out visitors read the summary on clubs but not the reviews", async () => {
    await withRole("authenticated", USERS.buyer1, async (c) => {
      const { galway } = await seedClubs(c);
      await c.query("insert into public.course_reviews (club_id, member_id, rating) values ($1, $2, 4)", [galway, USERS.buyer1]);
      await c.query("set local role anon");
      expectZeroRows(await c.query("select 1 from public.course_reviews"));
      const r = await c.query("select rating_count, rating_avg from public.clubs where id = $1", [galway]);
      expect(r.rows[0]).toEqual({ rating_count: 1, rating_avg: "4.0" });
    });
  });
});

describe("suggested_pinpals", () => {
  async function suggestions(c: PoolClient) {
    const r = await c.query("select id, same_club, distance_km, shared_courses from public.suggested_pinpals(20, 25)");
    return r.rows as { id: string; same_club: boolean; distance_km: string | null; shared_courses: number }[];
  }

  it("ranks same club, then nearby clubs; leaves out far away, blocked and already-connected", async () => {
    await withRole("authenticated", USERS.buyer1, async (c) => {
      const { galway, bearna, dublin } = await seedClubs(c);
      await setHomeClub(c, USERS.buyer1, galway);
      await setHomeClub(c, USERS.buyer2, bearna); // ~8 km
      await setHomeClub(c, USERS.seller1, galway); // same club
      await setHomeClub(c, USERS.seller2, dublin); // ~190 km

      const ids = (await suggestions(c)).map((r) => r.id);
      expect(ids.slice(0, 2)).toEqual([USERS.seller1, USERS.buyer2]);
      expect(ids).not.toContain(USERS.seller2);
      expect(ids).not.toContain(USERS.buyer1);

      // A pending request removes them from suggestions.
      await c.query("insert into public.connections (requester_id, recipient_id) values ($1, $2)", [USERS.buyer1, USERS.seller1]);
      expect((await suggestions(c)).map((r) => r.id)).not.toContain(USERS.seller1);

      // So does a block, in either direction.
      await setIdentity(c, USERS.buyer2);
      await c.query("insert into public.blocked_users (blocker_id, blocked_id) values ($1, $2)", [USERS.buyer2, USERS.buyer1]);
      await setIdentity(c, USERS.buyer1);
      expect((await suggestions(c)).map((r) => r.id)).not.toContain(USERS.buyer2);
    });
  });

  it("finds a far-away member through a shared course", async () => {
    await withRole("authenticated", USERS.buyer1, async (c) => {
      const { galway, dublin } = await seedClubs(c);
      await setHomeClub(c, USERS.buyer1, galway);
      await setHomeClub(c, USERS.seller2, dublin);
      await c.query("insert into public.member_courses (member_id, club_id, kind) values ($1, $2, 'bucket')", [USERS.buyer1, dublin]);
      await setIdentity(c, USERS.seller2);
      await c.query("insert into public.member_courses (member_id, club_id, kind) values ($1, $2, 'played')", [USERS.seller2, dublin]);
      await setIdentity(c, USERS.buyer1);

      const row = (await suggestions(c)).find((r) => r.id === USERS.seller2);
      expect(row?.shared_courses).toBe(1);
    });
  });

  it("is not callable signed out", async () => {
    await withRole("anon", null, async (c) => {
      await expectRejected(c.query("select * from public.suggested_pinpals(20, 25)"), /permission denied/);
    });
  });
});
