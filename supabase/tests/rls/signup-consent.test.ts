// Migration 0074 — the sign-up consent record and the private contact row.
//
// Two claims are made to members in writing and enforced only here, so they
// are what this file mainly tests:
//
//   1. "Never visible to other members" (Privacy Policy §3, and the note
//      under the phone field on the sign-up form) — a phone number must be
//      unreadable by any other member, staff excepted.
//   2. "Withdrawal is a new row, never an edit" (Terms §14 and the whole
//      point of an Art. 7(1) record) — nothing reachable through PostgREST
//      may update or delete a consent event.
//
// Plus the trigger path, which is the only way a consent row is ever written
// at sign-up: no session exists at that moment, so the row cannot be written
// by an authenticated client and a broken trigger would fail silently.
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { withRole, expectRejected, expectZeroRows, closePool, pool } from "./harness";
import { USERS } from "./fixtures";

afterAll(closePool);

/** Creates an auth.users row with a sign-up metadata payload, as the Server Action does. */
async function signUpWithMetadata(metadata: Record<string, unknown>): Promise<string> {
  const id = randomUUID();
  const client = await pool.connect();
  try {
    await client.query(
      `insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3::jsonb)`,
      [id, `${id}@example.test`, JSON.stringify(metadata)]
    );
  } finally {
    client.release();
  }
  return id;
}

const FULL_SIGNUP_METADATA = {
  first_name: "Aoife",
  last_name: "Nolan",
  phone_e164: "+353871234567",
  signup_referral_source: "club",
  signup_ip: "192.0.2.44",
  signup_user_agent: "Mozilla/5.0 (Test)",
  consents: [
    { type: "terms", granted: true, version: "1.0", sha256: "a".repeat(64) },
    { type: "privacy", granted: true, version: "1.0", sha256: "b".repeat(64) },
    { type: "marketplace_rules", granted: true, version: "1.0", sha256: "c".repeat(64) },
    { type: "community_guidelines", granted: true, version: "1.0", sha256: "d".repeat(64) },
    { type: "age_18_declaration", granted: true },
    { type: "marketing_email", granted: false },
  ],
};

describe("handle_new_user: the sign-up trigger", () => {
  it("records every consent in the payload, stamped as source 'signup'", async () => {
    const userId = await signUpWithMetadata(FULL_SIGNUP_METADATA);

    const client = await pool.connect();
    try {
      const r = await client.query(
        `select consent_type, granted, document_version, content_sha256, source,
                host(ip_address) as ip, user_agent
         from public.member_consent_events where user_id = $1 order by consent_type`,
        [userId]
      );
      expect(r.rowCount).toBe(6);
      expect(r.rows.map((row) => row.consent_type)).toEqual([
        "age_18_declaration",
        "community_guidelines",
        "marketing_email",
        "marketplace_rules",
        "privacy",
        "terms",
      ]);
      expect(r.rows.every((row) => row.source === "signup")).toBe(true);

      const terms = r.rows.find((row) => row.consent_type === "terms");
      expect(terms.granted).toBe(true);
      expect(terms.document_version).toBe("1.0");
      expect(terms.content_sha256).toBe("a".repeat(64));
      expect(terms.ip).toBe("192.0.2.44");
      expect(terms.user_agent).toBe("Mozilla/5.0 (Test)");

      // A declined newsletter is recorded as a "no", not left absent —
      // "declined" and "never asked" have to stay distinguishable.
      const marketing = r.rows.find((row) => row.consent_type === "marketing_email");
      expect(marketing.granted).toBe(false);

      // The non-document consents carry no version or hash.
      const age = r.rows.find((row) => row.consent_type === "age_18_declaration");
      expect(age.document_version).toBeNull();
      expect(age.content_sha256).toBeNull();
    } finally {
      client.release();
    }
  });

  it("stores the phone number and referral answer privately", async () => {
    const userId = await signUpWithMetadata(FULL_SIGNUP_METADATA);
    const client = await pool.connect();
    try {
      const r = await client.query(
        "select phone_e164, signup_referral_source from public.member_private_details where user_id = $1",
        [userId]
      );
      expect(r.rowCount).toBe(1);
      expect(r.rows[0].phone_e164).toBe("+353871234567");
      expect(r.rows[0].signup_referral_source).toBe("club");
    } finally {
      client.release();
    }
  });

  it("still creates a profile when there is no consent payload at all", async () => {
    // An admin invite, a Supabase dashboard user, or any account created
    // before this migration. The account must work regardless.
    const userId = await signUpWithMetadata({ first_name: "Legacy", last_name: "Member" });
    const client = await pool.connect();
    try {
      const profile = await client.query("select first_name from public.profiles where id = $1", [userId]);
      expect(profile.rowCount).toBe(1);
      expect(profile.rows[0].first_name).toBe("Legacy");

      const consents = await client.query(
        "select 1 from public.member_consent_events where user_id = $1",
        [userId]
      );
      expect(consents.rowCount).toBe(0);

      const priv = await client.query(
        "select 1 from public.member_private_details where user_id = $1",
        [userId]
      );
      expect(priv.rowCount).toBe(0);
    } finally {
      client.release();
    }
  });

  it("creates the account even when the consent payload is malformed", async () => {
    // A bad IP, a consent_type the CHECK constraint rejects: the additions
    // are non-fatal by design, because an account nobody can create is a
    // worse failure than a consent row that has to be re-captured.
    const userId = await signUpWithMetadata({
      first_name: "Robust",
      last_name: "Case",
      signup_ip: "not-an-ip",
      consents: [{ type: "not_a_real_consent_type", granted: true }],
    });
    const client = await pool.connect();
    try {
      const profile = await client.query("select first_name from public.profiles where id = $1", [userId]);
      expect(profile.rowCount).toBe(1);
    } finally {
      client.release();
    }
  });
});

describe("member_consent_events: SELECT", () => {
  it("a member reads their own consent history", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      await c.query(
        `insert into public.member_consent_events (user_id, consent_type, granted, source)
         values ($1, 'marketing_email', true, 'dashboard')`,
        [USERS.seller1]
      );
      const r = await c.query("select id from public.member_consent_events where user_id = $1", [
        USERS.seller1,
      ]);
      expect(r.rowCount).toBe(1);
    });
  });

  it("no other member can read it; staff can", async () => {
    const client = await pool.connect();
    let eventId: string;
    try {
      const inserted = await client.query(
        `insert into public.member_consent_events (user_id, consent_type, granted, source)
         values ($1, 'terms', true, 'signup') returning id`,
        [USERS.seller1]
      );
      eventId = inserted.rows[0].id;
    } finally {
      client.release();
    }

    await withRole("authenticated", USERS.buyer1, async (c) => {
      expectZeroRows(
        await c.query("select id from public.member_consent_events where id = $1", [eventId])
      );
    });
    await withRole("authenticated", USERS.admin, async (c) => {
      const r = await c.query("select id from public.member_consent_events where id = $1", [eventId]);
      expect(r.rowCount).toBe(1);
    });

    const cleanup = await pool.connect();
    try {
      await cleanup.query("delete from public.member_consent_events where id = $1", [eventId]);
    } finally {
      cleanup.release();
    }
  });

  it("is unreadable by anon", async () => {
    await withRole("anon", null, async (c) => {
      await expectRejected(c.query("select id from public.member_consent_events"), /permission denied/i);
    });
  });
});

describe("member_consent_events: append-only", () => {
  it("a member can append a row about themselves", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      const r = await c.query(
        `insert into public.member_consent_events (user_id, consent_type, granted, source)
         values ($1, 'marketing_email', false, 'dashboard') returning id`,
        [USERS.seller1]
      );
      expect(r.rowCount).toBe(1);
    });
  });

  it("cannot append a row about somebody else", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      await expectRejected(
        c.query(
          `insert into public.member_consent_events (user_id, consent_type, granted, source)
           values ($1, 'marketing_email', true, 'dashboard')`,
          [USERS.buyer1]
        ),
        /row-level security/i
      );
    });
  });

  it("cannot UPDATE a consent record — not even their own", async () => {
    const client = await pool.connect();
    let eventId: string;
    try {
      const inserted = await client.query(
        `insert into public.member_consent_events (user_id, consent_type, granted, source)
         values ($1, 'terms', true, 'signup') returning id`,
        [USERS.seller1]
      );
      eventId = inserted.rows[0].id;
    } finally {
      client.release();
    }

    await withRole("authenticated", USERS.seller1, async (c) => {
      await expectRejected(
        c.query("update public.member_consent_events set granted = false where id = $1", [eventId]),
        /permission denied/i
      );
    });
    await withRole("authenticated", USERS.admin, async (c) => {
      await expectRejected(
        c.query("update public.member_consent_events set granted = false where id = $1", [eventId]),
        /permission denied/i
      );
    });

    const cleanup = await pool.connect();
    try {
      await cleanup.query("delete from public.member_consent_events where id = $1", [eventId]);
    } finally {
      cleanup.release();
    }
  });

  it("cannot DELETE a consent record", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      await expectRejected(
        c.query("delete from public.member_consent_events where user_id = $1", [USERS.seller1]),
        /permission denied/i
      );
    });
  });

  it("rejects a consent type the application doesn't define", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      await expectRejected(
        c.query(
          `insert into public.member_consent_events (user_id, consent_type, granted, source)
           values ($1, 'sell_my_data', true, 'dashboard')`,
          [USERS.seller1]
        ),
        /consent_type/i
      );
    });
  });

  it("rejects a content hash that isn't a SHA-256", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      await expectRejected(
        c.query(
          `insert into public.member_consent_events
             (user_id, consent_type, granted, document_version, content_sha256, source)
           values ($1, 'terms', true, '1.0', 'not-a-hash', 'dashboard')`,
          [USERS.seller1]
        ),
        /content_sha256/i
      );
    });
  });
});

describe("member_current_consents: the latest event per type", () => {
  it("reflects the most recent event, and only the caller's own", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      await c.query(
        `insert into public.member_consent_events (user_id, consent_type, granted, source, occurred_at)
         values ($1, 'marketing_email', true, 'signup', now() - interval '2 days')`,
        [USERS.seller1]
      );
      await c.query(
        `insert into public.member_consent_events (user_id, consent_type, granted, source, occurred_at)
         values ($1, 'marketing_email', false, 'dashboard', now())`,
        [USERS.seller1]
      );

      const r = await c.query(
        "select granted from public.member_current_consents where consent_type = 'marketing_email'"
      );
      // Withdrawal is the newest row, so the current state is "no" — and the
      // "yes" that preceded it is still on the record underneath.
      expect(r.rowCount).toBe(1);
      expect(r.rows[0].granted).toBe(false);
    });
  });

  it("shows a member nothing about anybody else", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      await c.query(
        `insert into public.member_consent_events (user_id, consent_type, granted, source)
         values ($1, 'terms', true, 'signup')`,
        [USERS.seller1]
      );
      const r = await c.query("select user_id from public.member_current_consents");
      expect(r.rows.every((row) => row.user_id === USERS.seller1)).toBe(true);
    });
  });
});

describe("member_private_details: the phone number", () => {
  it("a member can write and read their own", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      await c.query(
        `insert into public.member_private_details (user_id, phone_e164) values ($1, '+353871112222')`,
        [USERS.seller1]
      );
      const r = await c.query(
        "select phone_e164 from public.member_private_details where user_id = $1",
        [USERS.seller1]
      );
      expect(r.rows[0].phone_e164).toBe("+353871112222");
    });
  });

  it("NO other member can read it — this is the guarantee the sign-up form makes", async () => {
    const client = await pool.connect();
    try {
      await client.query(
        `insert into public.member_private_details (user_id, phone_e164) values ($1, '+353879998888')
         on conflict (user_id) do update set phone_e164 = excluded.phone_e164`,
        [USERS.seller1]
      );
    } finally {
      client.release();
    }

    for (const other of [USERS.buyer1, USERS.seller2, USERS.buyer2]) {
      await withRole("authenticated", other, async (c) => {
        expectZeroRows(
          await c.query("select phone_e164 from public.member_private_details where user_id = $1", [
            USERS.seller1,
          ])
        );
      });
    }

    // Staff can, for support and abuse investigations — stated in the
    // Privacy Policy under "Who else touches it".
    await withRole("authenticated", USERS.admin, async (c) => {
      const r = await c.query(
        "select phone_e164 from public.member_private_details where user_id = $1",
        [USERS.seller1]
      );
      expect(r.rowCount).toBe(1);
    });

    const cleanup = await pool.connect();
    try {
      await cleanup.query("delete from public.member_private_details where user_id = $1", [USERS.seller1]);
    } finally {
      cleanup.release();
    }
  });

  it("is unreadable by anon", async () => {
    await withRole("anon", null, async (c) => {
      await expectRejected(
        c.query("select phone_e164 from public.member_private_details"),
        /permission denied/i
      );
    });
  });

  it("cannot be written on somebody else's behalf", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      await expectRejected(
        c.query(
          `insert into public.member_private_details (user_id, phone_e164) values ($1, '+353870000000')`,
          [USERS.buyer1]
        ),
        /row-level security/i
      );
    });
  });

  it("rejects a number that isn't E.164 — the backstop behind normalisePhone()", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      await expectRejected(
        c.query(
          `insert into public.member_private_details (user_id, phone_e164) values ($1, '087 123 4567')`,
          [USERS.seller1]
        ),
        /phone_e164/i
      );
    });
  });

  it("does not leak a phone number through the profiles table", async () => {
    // The reason this table exists. If a `phone` column is ever added to
    // `profiles`, this test is what should fail.
    await withRole("authenticated", USERS.buyer1, async (c) => {
      const r = await c.query(
        `select column_name from information_schema.columns
         where table_schema = 'public' and table_name = 'profiles'`
      );
      const columns = r.rows.map((row) => row.column_name as string);
      expect(columns).not.toContain("phone");
      expect(columns).not.toContain("phone_e164");
      expect(columns).not.toContain("date_of_birth");
    });
  });
});
