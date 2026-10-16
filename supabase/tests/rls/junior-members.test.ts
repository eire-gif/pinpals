// 0159_junior_members.sql — members aged 13 and over.
//
// What must hold:
//   - a date of birth can't make an account under 13, and once set only
//     staff can change or remove it
//   - a 13–15 year old does nothing involving anyone else until a parent
//     (18+, by their own date of birth) approves the link
//   - under 18: no tee times, Social, chat or marketplace selling/buying;
//     no creating or running groups
//   - 13–15: no PinPals requests; join only their parent's groups; play
//     only with their parent, approved contacts or people in a group with them
//   - a minor's profile is hidden from strangers but seen by the people they
//     play with; under 16 the surname shows as an initial
//   - Social reads come back empty for under-18s
//   - the sign-up trigger stores the date and the parent request, then
//     removes both from auth.users
//   - an app store saying "under 18" restricts an adult account for review
import { describe, it, expect, afterAll } from "vitest";
import type { PoolClient } from "pg";
import { withRole, closePool } from "./harness";
import { USERS } from "./fixtures";

afterAll(closePool);

const PARENT = USERS.seller1;
const STRANGER = USERS.seller2;
const TEEN = USERS.buyer1; // 16–17 in the tests that need one
const KID = USERS.buyer2; // 13–15
const ADMIN = USERS.admin;

const HASH = (n: number) => n.toString(16).padStart(64, "0");
const yearsAgo = (years: number, days = 0) => {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - years);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
};

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

async function setDob(c: PoolClient, user: string, dob: string) {
  await asService(c, () =>
    c.query(
      `insert into public.member_birthdates (user_id, date_of_birth) values ($1, $2)
       on conflict (user_id) do update set date_of_birth = excluded.date_of_birth`,
      [user, dob],
    ),
  );
}

/** As the table owner (past grants and RLS) but still "signed in" as
 *  whoever was set — what a SECURITY DEFINER function's write looks like. */
async function asOwner<T>(c: PoolClient, fn: () => Promise<T>): Promise<T> {
  await c.query("reset role");
  try {
    return await fn();
  } finally {
    await c.query("set local role authenticated");
  }
}

async function connect(c: PoolClient, a: string, b: string) {
  await asService(c, () =>
    c.query(
      `insert into public.connections (requester_id, recipient_id, status) values ($1, $2, 'accepted')
       on conflict (least(requester_id, recipient_id), greatest(requester_id, recipient_id)) do update set status = 'accepted'`,
      [a, b],
    ),
  );
}

/** KID is 14 with a pending request to PARENT (who is 45). */
async function kidWithRequest(c: PoolClient, hash = HASH(1)) {
  await setDob(c, PARENT, yearsAgo(45));
  await setDob(c, KID, yearsAgo(14));
  await asService(c, () =>
    c.query("insert into public.guardian_links (junior_id, guardian_email, token_hash) values ($1, 'parent@example.test', $2)", [
      KID,
      hash,
    ]),
  );
}

/** …and the parent has said yes. */
async function approvedKid(c: PoolClient) {
  await kidWithRequest(c);
  await as(c, PARENT);
  await c.query("select public.guardian_link_accept($1)", [HASH(1)]);
}

async function band(c: PoolClient, user: string): Promise<string> {
  await as(c, user);
  const { rows } = await c.query<{ a: { band: string } }>("select public.my_age_access() as a");
  return rows[0].a.band;
}

async function newGroup(c: PoolClient, owner: string): Promise<string> {
  return asService(c, async () => {
    const { rows } = await c.query<{ id: string }>(
      "insert into public.groups (kind, name, privacy, created_by) values ('crew', 'Portmarnock Juniors', 'invite', $1) returning id",
      [owner],
    );
    await c.query("insert into public.group_members (group_id, member_id, role) values ($1, $2, 'owner')", [rows[0].id, owner]);
    return rows[0].id;
  });
}

const card = JSON.stringify(Array.from({ length: 18 }, (_, i) => ({ hole: i + 1, par: 4, stroke_index: i + 1 })));
const roundJson = JSON.stringify({ course_name: "Portmarnock Golf Club", format: "stableford", holes: 18, allowance: 0.95, course_rating: 72, slope: 125, par_total: 72 });
const player = (memberId: string | null, name: string) => ({
  member_id: memberId,
  name,
  handicap_index: 20,
  course_handicap: 22,
  playing_handicap: 21,
  handicap_estimated: false,
});
const CREATE_ROUND = "select public.live_round_create($1::jsonb, $2::jsonb, $3::jsonb) as id";

describe("dates of birth", () => {
  it("can't make an account under 13, and can't be changed or removed by the member", async () => {
    await withRole("authenticated", KID, async (c) => {
      await rejects(c, "select public.set_my_date_of_birth($1::date)", [yearsAgo(12, 300)], /13 or over/);
      await c.query("select public.set_my_date_of_birth($1::date)", [yearsAgo(14)]);
      await rejects(c, "select public.set_my_date_of_birth($1::date)", [yearsAgo(30)], /can't be changed/);
      await rejects(c, "update public.member_birthdates set date_of_birth = $1 where user_id = $2", [yearsAgo(30), KID], /can't be changed/);
      await c.query("delete from public.member_birthdates where user_id = $1", [KID]);
      const left = await asService(c, () => c.query("select 1 from public.member_birthdates where user_id = $1", [KID]));
      expect(left.rowCount).toBe(1);
    });
  });

  it("staff can correct a date", async () => {
    await withRole("authenticated", ADMIN, async (c) => {
      await setDob(c, KID, yearsAgo(14));
      await as(c, ADMIN);
      // Staff edit through the website's service-role code; the trigger
      // trusts staff too.
      await asService(c, () => c.query("update public.member_birthdates set date_of_birth = $1 where user_id = $2", [yearsAgo(19), KID]));
      expect(await band(c, KID)).toBe("adult");
    });
  });

  it("members without a date are 'unknown' and keep adult access", async () => {
    await withRole("authenticated", STRANGER, async (c) => {
      await as(c, STRANGER);
      const { rows } = await c.query<{ a: { band: string; needsDateOfBirth: boolean; can: { teeTimes: boolean } } }>(
        "select public.my_age_access() as a",
      );
      expect(rows[0].a.band).toBe("unknown");
      expect(rows[0].a.needsDateOfBirth).toBe(true);
      expect(rows[0].a.can.teeTimes).toBe(true);
    });
  });
});

describe("the parent link", () => {
  it("a 13–15 year old waits for a parent, and can't start a round meanwhile", async () => {
    await withRole("authenticated", KID, async (c) => {
      await kidWithRequest(c);
      expect(await band(c, KID)).toBe("junior_pending");
      await as(c, KID);
      await rejects(c, CREATE_ROUND, [roundJson, JSON.stringify([player(KID, "Sam")]), card], /parent needs to approve/);
    });
  });

  it("the parent must be 18+ by their own date of birth", async () => {
    await withRole("authenticated", STRANGER, async (c) => {
      await kidWithRequest(c);
      await as(c, STRANGER); // no date of birth
      await rejects(c, "select public.guardian_link_accept($1)", [HASH(1)], /needs_dob/);
      await setDob(c, STRANGER, yearsAgo(17));
      await as(c, STRANGER);
      await rejects(c, "select public.guardian_link_accept($1)", [HASH(1)], /18 or over/);
      await as(c, KID);
      await rejects(c, "select public.guardian_link_accept($1)", [HASH(1)], /own account|18 or over/);
    });
  });

  it("once the parent says yes, the child can play", async () => {
    await withRole("authenticated", PARENT, async (c) => {
      await approvedKid(c);
      expect(await band(c, KID)).toBe("junior");
      await as(c, KID);
      const { rows } = await c.query(CREATE_ROUND, [roundJson, JSON.stringify([player(KID, "Sam"), player(null, "Grandad")]), card]);
      expect(rows[0].id).toBeTruthy();
      await as(c, PARENT);
      const kids = await c.query<{ junior_id: string; status: string }>("select junior_id, status from public.my_children()");
      expect(kids.rows).toEqual([{ junior_id: KID, status: "approved" }]);
    });
  });

  it("with the card check on, approval waits for it", async () => {
    await withRole("authenticated", PARENT, async (c) => {
      await asService(c, () =>
        c.query(
          `insert into public.age_settings (id, require_parent_card_check) values (true, true)
           on conflict (id) do update set require_parent_card_check = true`,
        ),
      );
      await kidWithRequest(c);
      await as(c, PARENT);
      const { rows } = await c.query<{ r: { status: string; linkId: number } }>("select public.guardian_link_accept($1) as r", [HASH(1)]);
      expect(rows[0].r.status).toBe("card_check");
      expect(await band(c, KID)).toBe("junior_pending");
      await as(c, PARENT);
      await rejects(c, "select public.guardian_link_card_checked($1, $2)", [rows[0].r.linkId, PARENT], /permission denied/);
      await asService(c, () => c.query("select public.guardian_link_card_checked($1, $2)", [rows[0].r.linkId, PARENT]));
      expect(await band(c, KID)).toBe("junior");
    });
  });

  it("the preview shows a first name only, to anyone with the link", async () => {
    await withRole("anon", null, async (c) => {
      await c.query("set local role authenticated");
      await kidWithRequest(c);
      await c.query("set local role anon");
      const { rows } = await c.query<{ p: Record<string, unknown> }>("select public.guardian_link_preview($1) as p", [HASH(1)]);
      expect(Object.keys(rows[0].p).sort()).toEqual(["awaitingCardCheck", "cardCheckRequired", "childFirstName", "invitedAt", "status"]);
      const none = await c.query<{ p: unknown }>("select public.guardian_link_preview($1) as p", [HASH(9)]);
      expect(none.rows[0].p).toBeNull();
      await rejects(c, "select * from public.guardian_links", [], /permission denied/);
    });
  });

  it("a revoked link puts the child back to waiting; only the parent can revoke", async () => {
    await withRole("authenticated", PARENT, async (c) => {
      await approvedKid(c);
      const { rows } = await c.query<{ id: string }>("select id from public.guardian_links where junior_id = $1", [KID]);
      await as(c, STRANGER);
      await rejects(c, "select public.guardian_link_revoke($1)", [rows[0].id], /Not allowed/);
      await as(c, PARENT);
      await c.query("select public.guardian_link_revoke($1)", [rows[0].id]);
      expect(await band(c, KID)).toBe("junior_pending");
    });
  });
});

describe("what under-18s can't do", () => {
  const writes: [string, string][] = [
    ["tee time", "insert into public.tee_time_invites (member_id, club_name, play_date, spaces_available) values ($1, 'Portmarnock', current_date + 3, 2)"],
    ["post", "insert into public.posts (author_id, body) values ($1, 'hello')"],
    ["listing", "insert into public.listings (seller_id, title, category, price_cents) values ($1, 'Driver', 'clubs', 1000)"],
    ["group", "select public.create_group('crew', 'Lads ' || $1::text, null, null, null, null)"],
  ];

  for (const [what, sql] of writes) {
    it(`a 16–17 year old can't create a ${what}`, async () => {
      await withRole("authenticated", TEEN, async (c) => {
        await setDob(c, TEEN, yearsAgo(17));
        await as(c, TEEN);
        await rejects(c, sql, [TEEN], /under 18/);
      });
    });
  }

  it("nobody can start a chat with, or invite to a tee time, someone under 18", async () => {
    await withRole("authenticated", STRANGER, async (c) => {
      await setDob(c, TEEN, yearsAgo(17));
      await as(c, STRANGER);
      await rejects(
        c,
        "insert into public.conversations (user_a_id, user_b_id) values (least($1::uuid, $2::uuid), greatest($1::uuid, $2::uuid))",
        [STRANGER, TEEN],
        /under 18/,
      );
      await asOwner(c, () =>
        rejects(
          c,
          "insert into public.tee_time_invitations (invite_id, member_id, invited_by) values (1, $1, $2)",
          [TEEN, STRANGER],
          /under 18/,
        ),
      );
    });
  });

  it("16–17 can make PinPals; under 16 can't", async () => {
    await withRole("authenticated", TEEN, async (c) => {
      await setDob(c, TEEN, yearsAgo(17));
      await as(c, TEEN);
      await c.query("insert into public.connections (requester_id, recipient_id) values ($1, $2)", [TEEN, STRANGER]);
      await approvedKid(c);
      await as(c, KID);
      await rejects(c, "insert into public.connections (requester_id, recipient_id) values ($1, $2)", [KID, STRANGER], /parent approves/);
      await as(c, STRANGER);
      await rejects(c, "insert into public.connections (requester_id, recipient_id) values ($1, $2)", [STRANGER, KID], /parent approves/);
    });
  });

  it("Social reads come back empty for under-18s", async () => {
    await withRole("authenticated", TEEN, async (c) => {
      await asService(c, () => c.query("insert into public.posts (author_id, body) values ($1, 'Birdie on 4')", [STRANGER]));
      await as(c, TEEN);
      const before = await c.query("select 1 from public.posts");
      expect(before.rowCount).toBeGreaterThan(0);
      await setDob(c, TEEN, yearsAgo(17));
      await as(c, TEEN);
      const after = await c.query("select 1 from public.posts");
      expect(after.rowCount).toBe(0);
    });
  });
});

describe("groups", () => {
  it("13–15 join only their parent's groups, and never as an officer", async () => {
    await withRole("authenticated", PARENT, async (c) => {
      await approvedKid(c);
      const strangers = await newGroup(c, STRANGER);
      const parents = await newGroup(c, PARENT);
      // Group joins all go through SECURITY DEFINER functions; this is the
      // write they make.
      await as(c, STRANGER);
      await asOwner(c, () =>
        rejects(c, "insert into public.group_members (group_id, member_id) values ($1, $2)", [strangers, KID], /parent's groups/),
      );
      await as(c, PARENT);
      await asOwner(c, () => c.query("insert into public.group_members (group_id, member_id) values ($1, $2)", [parents, KID]));
      await asOwner(c, () =>
        rejects(c, "update public.group_members set role = 'admin' where group_id = $1 and member_id = $2", [parents, KID], /can't run a group/),
      );
      await asOwner(c, () =>
        rejects(c, "update public.group_members set office = 'captain' where group_id = $1 and member_id = $2", [parents, KID], /can't run a group/),
      );
    });
  });
});

describe("playing with a 13–15 year old", () => {
  it("only the parent, approved contacts and people in a group with them", async () => {
    await withRole("authenticated", PARENT, async (c) => {
      await approvedKid(c);
      // A stranger can't put the child in their round, by any route (here a
      // write as a SECURITY DEFINER function would make it — the round
      // functions have their own PinPals check in front of this one).
      await as(c, STRANGER);
      const theirs = await c.query<{ id: string }>(CREATE_ROUND, [roundJson, JSON.stringify([player(STRANGER, "Pat"), player(null, "Sam")]), card]);
      await asOwner(c, () =>
        rejects(c, "update public.live_round_players set member_id = $1 where round_id = $2 and member_id is null", [KID, theirs.rows[0].id], /under 16/),
      );
      // The child can't add the stranger to theirs.
      await as(c, KID);
      const own = await c.query<{ id: string }>(CREATE_ROUND, [roundJson, JSON.stringify([player(KID, "Sam"), player(null, "Pat")]), card]);
      await asOwner(c, () =>
        rejects(c, "update public.live_round_players set member_id = $1 where round_id = $2 and member_id is null", [STRANGER, own.rows[0].id], /PinPals they approve/),
      );
      const clear = (id: string) => asService(c, () => c.query("delete from public.live_rounds where id = $1", [id]));
      await clear(theirs.rows[0].id);
      await clear(own.rows[0].id);
      // The parent can.
      await as(c, PARENT);
      const parents = await c.query<{ id: string }>(CREATE_ROUND, [roundJson, JSON.stringify([player(PARENT, "Eire"), player(KID, "Sam")]), card]);
      await clear(parents.rows[0].id);
      // Once the parent approves the stranger as a contact, they can too.
      await connect(c, PARENT, STRANGER);
      await as(c, PARENT);
      await c.query("select public.junior_contact_set($1, $2, true)", [KID, STRANGER]);
      await as(c, STRANGER);
      await c.query(CREATE_ROUND, [roundJson, JSON.stringify([player(STRANGER, "Pat"), player(KID, "Sam")]), card]);
      // Only the parent approves contacts, and only from their own PinPals.
      await as(c, STRANGER);
      await rejects(c, "select public.junior_contact_set($1, $2, true)", [KID, TEEN], /Only the parent/);
      await as(c, PARENT);
      await rejects(c, "select public.junior_contact_set($1, $2, true)", [KID, TEEN], /own PinPals/);
    });
  });
});

describe("profiles", () => {
  it("a minor is hidden from strangers, seen by their parent, and under 16 shows a surname initial", async () => {
    await withRole("authenticated", PARENT, async (c) => {
      const before = await asService(c, () => c.query<{ last_name: string }>("select last_name from public.profiles where id = $1", [KID]));
      await approvedKid(c);
      const after = await asService(c, () => c.query<{ last_name: string }>("select last_name from public.profiles where id = $1", [KID]));
      expect(after.rows[0].last_name).toMatch(/^.\.$/);
      expect(after.rows[0].last_name[0]).toBe(before.rows[0].last_name.trim()[0].toUpperCase());
      await as(c, STRANGER);
      expect((await c.query("select 1 from public.profiles where id = $1", [KID])).rowCount).toBe(0);
      await as(c, PARENT);
      expect((await c.query("select 1 from public.profiles where id = $1", [KID])).rowCount).toBe(1);
      const kids = await c.query<{ last_name: string }>("select last_name from public.my_children()");
      expect(kids.rows[0].last_name).toBe(before.rows[0].last_name);
      await as(c, KID);
      expect((await c.query("select 1 from public.profiles where id = $1", [KID])).rowCount).toBe(1);
    });
  });

  it("a 16–17 year old is seen by their PinPals", async () => {
    await withRole("authenticated", STRANGER, async (c) => {
      await setDob(c, TEEN, yearsAgo(17));
      await as(c, STRANGER);
      expect((await c.query("select 1 from public.profiles where id = $1", [TEEN])).rowCount).toBe(0);
      await connect(c, STRANGER, TEEN);
      await as(c, STRANGER);
      expect((await c.query("select 1 from public.profiles where id = $1", [TEEN])).rowCount).toBe(1);
    });
  });
});

describe("signing up", () => {
  it("stores the date and the parent request, then clears them from auth.users", async () => {
    await withRole("service_role", null, async (c) => {
      await c.query("reset role");
      const id = "00000000-0000-0000-0000-0000000000a1";
      await c.query(
        `insert into auth.users (id, email, raw_user_meta_data) values ($1, 'kid@example.test', $2::jsonb)`,
        [
          id,
          JSON.stringify({
            first_name: "Sam",
            last_name: "Murphy",
            date_of_birth: yearsAgo(14),
            guardian_email: "Parent@Example.test",
            guardian_token_hash: HASH(7),
          }),
        ],
      );
      const dob = await c.query("select 1 from public.member_birthdates where user_id = $1", [id]);
      expect(dob.rowCount).toBe(1);
      const link = await c.query<{ guardian_email: string; status: string }>(
        "select guardian_email, status from public.guardian_links where junior_id = $1",
        [id],
      );
      expect(link.rows).toEqual([{ guardian_email: "parent@example.test", status: "pending" }]);
      const meta = await c.query<{ m: Record<string, unknown> }>("select raw_user_meta_data as m from auth.users where id = $1", [id]);
      expect(meta.rows[0].m).not.toHaveProperty("date_of_birth");
      expect(meta.rows[0].m).not.toHaveProperty("guardian_email");
      const profile = await c.query<{ last_name: string }>("select last_name from public.profiles where id = $1", [id]);
      expect(profile.rows[0].last_name).toBe("M.");
    });
  });

  it("an under-16 sign-up without a parent email fails", async () => {
    await withRole("service_role", null, async (c) => {
      await c.query("reset role");
      await rejects(
        c,
        `insert into auth.users (id, email, raw_user_meta_data) values ('00000000-0000-0000-0000-0000000000a2', 'kid2@example.test', $1::jsonb)`,
        [JSON.stringify({ first_name: "Sam", last_name: "Murphy", date_of_birth: yearsAgo(14) })],
        /parent or guardian/,
      );
    });
  });
});

describe("store signals and staff review", () => {
  it("an app store saying under 18 restricts an adult account until staff clear it", async () => {
    await withRole("authenticated", STRANGER, async (c) => {
      await setDob(c, STRANGER, yearsAgo(30));
      await as(c, STRANGER);
      await c.query("select public.report_store_age_signal('ios', 13, 15, 'sharing')");
      expect(await band(c, STRANGER)).toBe("youth");
      await as(c, STRANGER);
      await rejects(c, "select public.admin_set_age_flag($1, false, null)", [STRANGER], /Not allowed/);
      expect((await c.query("select 1 from public.member_age_flags")).rowCount).toBe(0);
      await as(c, ADMIN);
      await c.query("select public.admin_set_age_flag($1, false, 'Checked ID')", [STRANGER]);
      expect(await band(c, STRANGER)).toBe("adult");
    });
  });
});

describe("adverts", () => {
  it("under-18s never get alcohol, betting or targeted adverts", async () => {
    await withRole("authenticated", TEEN, async (c) => {
      const ids = await asService(c, async () => {
        await c.query(
          `insert into public.ad_settings (id, ads_enabled, new_member_ad_free_days, takeover_min_hours_between) values (true, true, 0, 4)
           on conflict (id) do update set ads_enabled = true, new_member_ad_free_days = 0`,
        );
        const adv = await c.query<{ id: string }>("insert into public.advertisers (name) values ('Test Co') returning id");
        const mk = (category: string, regions: string[]) =>
          c.query<{ id: string }>(
            `insert into public.ad_campaigns (advertiser_id, name, category, format, image_url, link_url, countries, regions, club_ids,
                                              starts_at, ends_at, status, pricing_model, rate_eur, sensitive_ack_at)
             values ($1, $2, $3, 'feed', 'https://cdn.example.com/a.jpg', 'https://example.com', '{}', $4, '{}',
                     now() - interval '1 hour', now() + interval '30 days', 'approved', 'flat', 500,
                     case when $3 in ('alcohol', 'betting') then now() end)
             returning id`,
            [adv.rows[0].id, `${category}-${regions.length}`, category, regions],
          );
        return {
          plain: (await mk("equipment", [])).rows[0].id,
          beer: (await mk("alcohol", [])).rows[0].id,
          local: (await mk("equipment", ["dublin"])).rows[0].id,
        };
      });
      await as(c, TEEN);
      const adult = (await c.query<{ id: string }>("select id from public.ads_for_me(null, 'dublin', null)")).rows.map((r) => r.id);
      expect(adult).toEqual(expect.arrayContaining([ids.plain, ids.beer, ids.local]));
      await setDob(c, TEEN, yearsAgo(17));
      await as(c, TEEN);
      const minor = (await c.query<{ id: string }>("select id from public.ads_for_me(null, 'dublin', null)")).rows.map((r) => r.id);
      expect(minor).toContain(ids.plain);
      expect(minor).not.toContain(ids.beer);
      expect(minor).not.toContain(ids.local);
    });
  });
});
