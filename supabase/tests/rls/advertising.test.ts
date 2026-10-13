// 0139_advertising.sql — advertisers, campaigns, settings, events, rollup.
//
// What must hold:
//   - members and visitors can't write any advertising table, and can't read
//     campaigns (prices, drafts, contact details) directly; staff can read
//   - ads_for_me() returns live approved adverts only — never a draft, a
//     pending one, a paused one, one outside its dates, or anything while the
//     master switch is off — and applies targeting, the new-member quiet
//     period and the takeover frequency cap
//   - ad_log() refuses a campaign that isn't live
//   - billable counting is de-duplicated: a view once per member per campaign
//     per hour, a click once per day; anonymous views are counted apart
//   - a CPM campaign that reaches its budget cap ends and stops serving
//   - alcohol/betting can't be approved without the staff confirmation
import { describe, it, expect, afterAll } from "vitest";
import type { PoolClient } from "pg";
import { withRole, setIdentity, closePool, expectRejected } from "./harness";
import { USERS } from "./fixtures";

afterAll(closePool);

const MEMBER = USERS.buyer1;
const OTHER = USERS.buyer2;

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

type CampaignOpts = {
  status?: string;
  format?: string;
  category?: string;
  countries?: string[];
  regions?: string[];
  clubIds?: number[];
  pricing?: "flat" | "cpm" | "cpc";
  rate?: number;
  cap?: number | null;
  startsInHours?: number;
  endsInHours?: number;
};

/** Switches ads on with no quiet period, then makes a campaign (service role). */
async function campaign(c: PoolClient, opts: CampaignOpts = {}): Promise<string> {
  return asService(c, async () => {
    // Upsert: the suite's global setup truncates every table, the settings row included.
    await c.query(
      `insert into public.ad_settings (id, ads_enabled, new_member_ad_free_days, takeover_min_hours_between) values (true, true, 0, 4)
       on conflict (id) do update set ads_enabled = true, new_member_ad_free_days = 0, takeover_min_hours_between = 4`,
    );
    const adv = await c.query<{ id: string }>("insert into public.advertisers (name) values ('Algarve Golf Breaks') returning id");
    const { rows } = await c.query<{ id: string }>(
      `insert into public.ad_campaigns (advertiser_id, name, category, format, image_url, link_url, countries, regions, club_ids,
                                        starts_at, ends_at, status, pricing_model, rate_eur, budget_cap_eur, sensitive_ack_at)
       values ($1, 'Spring in the Algarve', $2, $3, 'https://cdn.example.com/a.jpg', 'https://example.com/algarve', $4, $5, $6,
               now() + make_interval(hours => $7), now() + make_interval(hours => $8), $9, $10, $11, $12,
               case when $2 in ('alcohol', 'betting') then now() end)
       returning id`,
      [
        adv.rows[0].id,
        opts.category ?? "golf_travel",
        opts.format ?? "feed",
        opts.countries ?? [],
        opts.regions ?? [],
        opts.clubIds ?? [],
        opts.startsInHours ?? -1,
        opts.endsInHours ?? 24 * 30,
        opts.status ?? "approved",
        opts.pricing ?? "flat",
        opts.rate ?? 500,
        opts.cap ?? null,
      ],
    );
    return rows[0].id;
  });
}

async function myAdIds(c: PoolClient, country: string | null = null, region: string | null = null, club: number | null = null): Promise<string[]> {
  const { rows } = await c.query<{ id: string }>("select id from public.ads_for_me($1, $2, $3)", [country, region, club]);
  return rows.map((r) => r.id);
}

async function stats(c: PoolClient, id: string) {
  return asService(c, async () => {
    const { rows } = await c.query<{ views: number; clicks: number; dismisses: number; anon_views: number }>(
      "select coalesce(sum(views),0)::int as views, coalesce(sum(clicks),0)::int as clicks, coalesce(sum(dismisses),0)::int as dismisses, coalesce(sum(anon_views),0)::int as anon_views from public.ad_daily_stats where campaign_id = $1",
      [id],
    );
    return rows[0];
  });
}

describe("advertising: no client writes, no direct reads", () => {
  it("members can't write any advertising table", async () => {
    await withRole("authenticated", MEMBER, async (c) => {
      const id = await campaign(c);
      await setIdentity(c, MEMBER);
      await rejects(c, "insert into public.advertisers (name) values ('Sneaky Ltd')", []);
      await rejects(c, "update public.ad_campaigns set rate_eur = 0 where id = $1", [id]);
      await rejects(c, "update public.ad_settings set ads_enabled = false", []);
      await rejects(c, "insert into public.ad_events (campaign_id, member_id, kind, source) values ($1, $2, 'view', 'app')", [id, MEMBER]);
      await rejects(c, "insert into public.ad_daily_stats (campaign_id, day, views) values ($1, current_date, 1000000)", [id]);
    });
  });

  it("members and visitors can't read campaigns, even live ones; staff can", async () => {
    await withRole("authenticated", MEMBER, async (c) => {
      const id = await campaign(c);
      await setIdentity(c, MEMBER);
      expect((await c.query("select 1 from public.ad_campaigns where id = $1", [id])).rowCount).toBe(0);
      expect((await c.query("select 1 from public.advertisers")).rowCount).toBe(0);
      expect((await c.query("select 1 from public.ad_settings")).rowCount).toBe(0);
      await setIdentity(c, USERS.admin);
      expect((await c.query("select 1 from public.ad_campaigns where id = $1", [id])).rowCount).toBe(1);
    });
    await withRole("anon", null, async (c) => {
      await expectRejected(c.query("select 1 from public.ad_campaigns"));
    });
  });
});

describe("ads_for_me()", () => {
  it("shows live approved adverts only, and nothing while the master switch is off", async () => {
    await withRole("authenticated", MEMBER, async (c) => {
      const live = await campaign(c);
      const draft = await campaign(c, { status: "draft" });
      const pending = await campaign(c, { status: "pending_approval" });
      const paused = await campaign(c, { status: "paused" });
      const future = await campaign(c, { startsInHours: 5 });
      const past = await campaign(c, { startsInHours: -48, endsInHours: -1 });
      await setIdentity(c, MEMBER);
      const ids = await myAdIds(c);
      expect(ids).toContain(live);
      for (const hidden of [draft, pending, paused, future, past]) expect(ids).not.toContain(hidden);

      await asService(c, () => c.query("update public.ad_settings set ads_enabled = false"));
      expect(await myAdIds(c)).toEqual([]);
    });
  });

  it("returns display fields only", async () => {
    await withRole("authenticated", MEMBER, async (c) => {
      await campaign(c);
      await setIdentity(c, MEMBER);
      const { fields } = await c.query("select * from public.ads_for_me(null, null, null)");
      const names = fields.map((f) => f.name);
      for (const secret of ["rate_eur", "budget_cap_eur", "payment_status", "status", "pricing_model", "advertiser_id"]) {
        expect(names).not.toContain(secret);
      }
    });
  });

  it("applies country, county and course targeting", async () => {
    await withRole("authenticated", MEMBER, async (c) => {
      const club = (await c.query<{ id: string }>("select id from public.clubs order by id limit 1")).rows[0].id;
      const spain = await campaign(c, { countries: ["spain"] });
      const kerry = await campaign(c, { countries: ["ireland"], regions: ["Kerry"] });
      const partner = await campaign(c, { format: "course_partner", clubIds: [Number(club)] });
      await setIdentity(c, MEMBER);
      const dublin = await myAdIds(c, "ireland", "Dublin", null);
      expect(dublin).not.toContain(spain);
      expect(dublin).not.toContain(kerry);
      expect(dublin).not.toContain(partner);
      const kerryIds = await myAdIds(c, "ireland", "kerry", Number(club));
      expect(kerryIds).toContain(kerry);
      expect(kerryIds).toContain(partner);
      expect(await myAdIds(c, "spain", null, null)).toContain(spain);
    });
  });

  it("keeps new members ad-free for their first days", async () => {
    await withRole("authenticated", MEMBER, async (c) => {
      const id = await campaign(c);
      await asService(c, async () => {
        await c.query("update public.ad_settings set new_member_ad_free_days = 7");
        await c.query("update public.profiles set created_at = now() - interval '2 days' where id = $1", [MEMBER]);
      });
      await setIdentity(c, MEMBER);
      expect(await myAdIds(c)).not.toContain(id);
      await asService(c, () => c.query("update public.profiles set created_at = now() - interval '8 days' where id = $1", [MEMBER]));
      await setIdentity(c, MEMBER);
      expect(await myAdIds(c)).toContain(id);
    });
  });

  it("holds back takeovers inside the frequency gap", async () => {
    await withRole("authenticated", MEMBER, async (c) => {
      const first = await campaign(c, { format: "takeover" });
      const second = await campaign(c, { format: "takeover" });
      await setIdentity(c, MEMBER);
      expect(await myAdIds(c)).toEqual(expect.arrayContaining([first, second]));
      await c.query("select public.ad_log($1, 'view', 'app')", [first]);
      const after = await myAdIds(c);
      expect(after).not.toContain(first);
      expect(after).not.toContain(second);
      // Someone else still gets them.
      await setIdentity(c, OTHER);
      expect(await myAdIds(c)).toEqual(expect.arrayContaining([first, second]));
    });
  });
});

describe("ad_log()", () => {
  it("refuses a campaign that isn't live", async () => {
    await withRole("authenticated", MEMBER, async (c) => {
      const draft = await campaign(c, { status: "draft" });
      const ended = await campaign(c, { startsInHours: -48, endsInHours: -1 });
      await setIdentity(c, MEMBER);
      await rejects(c, "select public.ad_log($1, 'view', 'app')", [draft], /isn't running/);
      await rejects(c, "select public.ad_log($1, 'click', 'app')", [ended], /isn't running/);
      await rejects(c, "select public.ad_log($1, 'like', 'app')", [draft], /Unknown advert event/);
    });
  });

  it("de-duplicates: a view once an hour, a click once a day, per member", async () => {
    await withRole("authenticated", MEMBER, async (c) => {
      const id = await campaign(c);
      await setIdentity(c, MEMBER);
      for (let i = 0; i < 5; i++) await c.query("select public.ad_log($1, 'view', 'app')", [id]);
      const links: string[] = [];
      for (let i = 0; i < 3; i++) links.push((await c.query<{ l: string }>("select public.ad_log($1, 'click', 'app') as l", [id])).rows[0].l);
      // Every tap still gets the link; only the first one counts.
      expect(links).toEqual(["https://example.com/algarve", "https://example.com/algarve", "https://example.com/algarve"]);
      await setIdentity(c, OTHER);
      await c.query("select public.ad_log($1, 'view', 'app')", [id]);
      expect(await stats(c, id)).toMatchObject({ views: 2, clicks: 1 });
    });
  });

  it("counts anonymous website views apart, never billed", async () => {
    await withRole("authenticated", MEMBER, async (c) => {
      const id = await campaign(c);
      await c.query("set local role anon");
      await c.query("select set_config('request.jwt.claim.sub', '', true)");
      await c.query("select public.ad_log($1, 'view', 'web')", [id]);
      await c.query("select public.ad_log($1, 'view', 'web')", [id]);
      await c.query("set local role authenticated");
      expect(await stats(c, id)).toMatchObject({ views: 0, anon_views: 2 });
    });
  });

  it("ends a CPM campaign when its budget cap is reached, and it stops serving", async () => {
    await withRole("authenticated", MEMBER, async (c) => {
      // €1,000 per 1,000 views = €1 a view; a €1.50 cap is spent by the 2nd view.
      const id = await campaign(c, { pricing: "cpm", rate: 1000, cap: 1.5 });
      await setIdentity(c, MEMBER);
      await c.query("select public.ad_log($1, 'view', 'app')", [id]);
      expect(await myAdIds(c)).toContain(id);
      await setIdentity(c, OTHER);
      await c.query("select public.ad_log($1, 'view', 'app')", [id]);
      const row = await asService(c, async () => (await c.query("select status, end_reason from public.ad_campaigns where id = $1", [id])).rows[0]);
      expect(row).toEqual({ status: "ended", end_reason: "budget_cap" });
      await setIdentity(c, MEMBER);
      expect(await myAdIds(c)).not.toContain(id);
      await rejects(c, "select public.ad_log($1, 'view', 'app')", [id], /isn't running/);
    });
  });
});

describe("approval rules in the table itself", () => {
  it("alcohol and betting can't be approved without the staff confirmation", async () => {
    await withRole("authenticated", MEMBER, async (c) => {
      const id = await campaign(c, { category: "alcohol", status: "pending_approval" });
      await asService(c, async () => {
        await c.query("update public.ad_campaigns set sensitive_ack_at = null where id = $1", [id]);
        await rejects(c, "update public.ad_campaigns set status = 'approved' where id = $1", [id], /ad_campaigns_sensitive_approved/);
        await c.query("update public.ad_campaigns set sensitive_ack_at = now(), status = 'approved' where id = $1", [id]);
      });
    });
  });

  it("links must be https", async () => {
    await withRole("authenticated", MEMBER, async (c) => {
      const id = await campaign(c);
      await asService(c, async () => {
        await rejects(c, "update public.ad_campaigns set link_url = 'http://example.com' where id = $1", [id]);
        await rejects(c, "update public.ad_campaigns set link_url = 'javascript:alert(1)' where id = $1", [id]);
      });
    });
  });
});
