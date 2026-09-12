// Function EXECUTE grants for every SECURITY DEFINER function in `public`.
//
// WHY THIS FILE EXISTS. On 12 September 2026, migration 0075 dropped and
// recreated notify_user() to change its return type, and tried to restore its
// original {postgres, service_role} ACL with `revoke all ... from public`.
// That is not sufficient on Supabase: setup-local-db-part1.sql (mirroring the
// real project) runs
//
//   alter default privileges in schema public grant execute on functions
//     to anon, authenticated;
//
// so every new function gets an EXPLICIT per-role grant, which a revoke aimed
// at the PUBLIC pseudo-role does not touch. notify_user() — SECURITY DEFINER,
// taking p_user_id as a parameter — was briefly callable at
// /rest/v1/rpc/notify_user by any signed-in member and by anyone holding the
// publishable anon key, i.e. an arbitrary-notification-to-any-member hole.
// See claude/incident-notify-user-grants-after-recreate.md.
//
// The rest of this suite tests POLICIES. Nothing in it tests GRANTS, which is
// precisely why that bug reached production. RLS is irrelevant to a SECURITY
// DEFINER function: it runs as the owner, so the grant IS the boundary.
//
// HOW TO USE IT. EXPECTED below is a snapshot of who may execute what, taken
// from production after the fix. It is not an aspiration — it is the current,
// reviewed state. Any drift fails, in either direction:
//
//   - A new SECURITY DEFINER function fails test 1 until someone adds it here
//     and, in doing so, consciously answers "should anon be able to call this?"
//   - A widened grant fails test 3 with the role named.
//   - A function that is dropped or renamed fails test 2, so this list can't
//     rot into a fiction.
//
// When a failure is legitimate, update the entry AND make sure the migration
// that caused it revokes by name:
//
//   revoke all on function public.<fn>(<args>) from public, anon, authenticated;
//   grant execute on function public.<fn>(<args>) to <only what needs it>;
//
// KNOWN-ACCEPTED ODDITY, recorded rather than silently tolerated:
// handle_new_user(), sync_denormalised_club_names() and validate_article_image()
// are TRIGGER functions that are nonetheless executable by anon. Calling a
// trigger function directly over PostgREST fails at runtime ("trigger functions
// can only be called as triggers"), so this is noise rather than an opening —
// but they have no business being callable and revoking them is a tidy-up worth
// doing in some future migration. They are marked `triggerFn: true` below so
// that clean-up can be spotted and this list updated in one place.

import { describe, it, expect, afterAll } from "vitest";
import { pool, closePool } from "./harness";

afterAll(closePool);

type Expectation = {
  anon: boolean;
  authenticated: boolean;
  /** A trigger function — see the note above. Documentation only. */
  triggerFn?: true;
};

// Keyed by `proname(pg_get_function_identity_arguments(oid))`, exactly as the
// query below builds it, so a signature change shows up as an add + a removal
// rather than a silently-passing rename.
const EXPECTED: Record<string, Expectation> = {
  // --- Reachable by anyone, deliberately: the *_is_visible helpers exist so
  // --- anonymous visitors can browse listings, reviews and invites without
  // --- hitting `permission denied for function is_staff` (0045/0056).
  "invite_is_visible_row(target_visibility text, target_member_id uuid)": { anon: true, authenticated: true },
  "listing_is_visible(target_listing_id bigint)": { anon: true, authenticated: true },
  "listing_is_visible_row(target_status text, target_seller_id uuid, target_listing_id bigint)": {
    anon: true,
    authenticated: true,
  },
  "review_is_visible(p_hidden_at timestamp with time zone, p_reviewer_id uuid, p_reviewee_id uuid)": {
    anon: true,
    authenticated: true,
  },

  // --- Trigger functions that are nonetheless anon-executable. See the note.
  "handle_new_user()": { anon: true, authenticated: true, triggerFn: true },
  "sync_denormalised_club_names()": { anon: true, authenticated: true, triggerFn: true },
  "validate_article_image()": { anon: true, authenticated: true, triggerFn: true },

  // --- Signed-in members only. Each is safe to expose because it either takes
  // --- no caller-controlled identity, or derives identity from auth.uid().
  "are_connected(a uuid, b uuid)": { anon: false, authenticated: true },
  "can_message(a uuid, b uuid)": { anon: false, authenticated: true },
  "get_order_dispute_status(p_order_id bigint)": { anon: false, authenticated: true },
  "is_blocked(a uuid, b uuid)": { anon: false, authenticated: true },
  "is_staff(required_roles text[])": { anon: false, authenticated: true },
  "register_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text)": {
    anon: false,
    authenticated: true,
  },
  // 0077. Both derive the caller from auth.uid() and check ownership against
  // it — the host for one, the requester for the other — so being callable
  // by a signed-in member is exactly the intent. They exist as SECURITY
  // DEFINER functions so the space count can be changed under a row lock.
  "respond_to_tee_time_interest(p_interest_id bigint, p_accept boolean)": { anon: false, authenticated: true },
  "confirm_tee_time_place(p_interest_id bigint, p_attending boolean)": { anon: false, authenticated: true },

  // --- Service role / internal only. Everything below is either a trigger
  // --- function, a sweep, or a privileged write path that must never be
  // --- reachable from a browser.
  "admin_distinct_webhook_event_types()": { anon: false, authenticated: false },
  "apply_new_bid()": { anon: false, authenticated: false },
  "create_purchase_order(p_caller_id uuid, p_listing_id bigint, p_delivery_method text, p_address_id bigint, p_reservation_minutes integer)":
    { anon: false, authenticated: false },
  "enforce_listing_image_limit()": { anon: false, authenticated: false },
  "expire_stale_offers()": { anon: false, authenticated: false },
  "finalize_offer_checkout(p_caller_id uuid, p_order_id bigint, p_delivery_method text, p_address_id bigint)": {
    anon: false,
    authenticated: false,
  },
  "invalidate_offers_on_listing_unavailable()": { anon: false, authenticated: false },
  "log_offer_event()": { anon: false, authenticated: false },
  "log_order_event()": { anon: false, authenticated: false },
  "notify_seller_of_new_offer()": { anon: false, authenticated: false },
  "notify_user(p_user_id uuid, p_type text, p_title text, p_body text, p_data jsonb, p_dedupe_key text)": {
    anon: false,
    authenticated: false,
  },
  "offer_action(p_offer_id bigint, p_caller_id uuid, p_action text, p_counter_amount_cents integer, p_checkout_minutes integer)":
    { anon: false, authenticated: false },
  "prepare_and_validate_offer()": { anon: false, authenticated: false },
  "prevent_auction_edit_after_first_bid()": { anon: false, authenticated: false },
  "prevent_conversation_tampering()": { anon: false, authenticated: false },
  "prevent_listing_edit_during_live_auction()": { anon: false, authenticated: false },
  "prevent_notification_tampering()": { anon: false, authenticated: false },
  "prevent_offer_self_dealing()": { anon: false, authenticated: false },
  "prevent_review_moderation_tampering()": { anon: false, authenticated: false },
  "release_expired_offer_reservations()": { anon: false, authenticated: false },
  "run_auction_sweeps()": { anon: false, authenticated: false },
  "touch_conversation_last_message()": { anon: false, authenticated: false },
  "validate_bid()": { anon: false, authenticated: false },
  "validate_listing_status_transition()": { anon: false, authenticated: false },
  "validate_message_content()": { anon: false, authenticated: false },
  "validate_review()": { anon: false, authenticated: false },
};

type ActualRow = { signature: string; anon: boolean; authenticated: boolean };

/** Reads the catalogue directly rather than through withRole(): this asks
 * "who is GRANTED what", which has_function_privilege() answers for any role
 * from any connection. There is no identity to simulate here — that is the
 * whole point of the file. */
async function readActual(): Promise<ActualRow[]> {
  const result = await pool.query<ActualRow>(`
    select
      p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as signature,
      has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
      has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
    order by 1
  `);
  return result.rows;
}

describe("SECURITY DEFINER function grants", () => {
  it("every SECURITY DEFINER function in public is accounted for", async () => {
    const actual = await readActual();
    const unlisted = actual.map((r) => r.signature).filter((s) => !(s in EXPECTED));

    // A new SECURITY DEFINER function inherits EXECUTE for anon and
    // authenticated from Supabase's default privileges. If you are reading
    // this because the test failed: decide whether that is what you want,
    // revoke by name in the migration if it isn't, then add the entry.
    expect(unlisted, `Unlisted SECURITY DEFINER function(s):\n  ${unlisted.join("\n  ")}`).toEqual([]);
  });

  it("has no stale entries for functions that no longer exist", async () => {
    const actual = await readActual();
    const live = new Set(actual.map((r) => r.signature));
    const stale = Object.keys(EXPECTED).filter((s) => !live.has(s));

    expect(stale, `EXPECTED lists function(s) that no longer exist:\n  ${stale.join("\n  ")}`).toEqual([]);
  });

  it("grants match the reviewed expectation for every function", async () => {
    const actual = await readActual();
    const drift: string[] = [];

    for (const row of actual) {
      const expected = EXPECTED[row.signature];
      if (!expected) continue; // covered by the first test

      if (row.anon !== expected.anon) {
        drift.push(`${row.signature}: anon EXECUTE is ${row.anon}, expected ${expected.anon}`);
      }
      if (row.authenticated !== expected.authenticated) {
        drift.push(
          `${row.signature}: authenticated EXECUTE is ${row.authenticated}, expected ${expected.authenticated}`
        );
      }
    }

    expect(drift, `Function grant drift:\n  ${drift.join("\n  ")}`).toEqual([]);
  });
});

describe("SECURITY DEFINER functions: the two that caused the incident", () => {
  // Deliberately duplicates the table-driven test above. When one of these
  // fails in eighteen months, the person reading the output needs the reason,
  // not just a boolean mismatch.

  it("notify_user() is unreachable from a browser, by either role", async () => {
    const actual = await readActual();
    const row = actual.find((r) => r.signature.startsWith("notify_user("));

    expect(row, "notify_user() is missing or no longer SECURITY DEFINER").toBeDefined();

    // It is SECURITY DEFINER and takes p_user_id as a parameter, so EXECUTE
    // for either of these roles means anyone can write an arbitrary
    // notification — title, body and a rendered link — into any member's
    // account. RLS cannot help: the function runs as its owner.
    expect(row!.anon, "anon can execute notify_user() — see incident-notify-user-grants-after-recreate.md").toBe(
      false
    );
    expect(
      row!.authenticated,
      "authenticated can execute notify_user() — see incident-notify-user-grants-after-recreate.md"
    ).toBe(false);
  });

  it("register_push_subscription() is callable by members but not anonymously", async () => {
    const actual = await readActual();
    const row = actual.find((r) => r.signature.startsWith("register_push_subscription("));

    expect(row, "register_push_subscription() is missing or no longer SECURITY DEFINER").toBeDefined();

    // Safe for `authenticated` by construction: it writes auth.uid(), never a
    // caller-supplied id, so a member can only ever claim a device for
    // themselves. `anon` would only reach its "requires an authenticated
    // member" exception, but has no reason to hold the grant.
    expect(row!.authenticated, "members must be able to register their own device").toBe(true);
    expect(row!.anon, "anon should not be able to execute register_push_subscription()").toBe(false);
  });
});
