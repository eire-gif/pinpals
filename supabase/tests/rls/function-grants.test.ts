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
// Trigger functions: handle_new_user(), sync_denormalised_club_names() and
// validate_article_image() used to be executable by anon (noise rather than an
// opening — a trigger function can't be called directly). 0133 revoked them;
// every trigger function is now unreachable from a browser.

import { describe, it, expect, afterAll } from "vitest";
import { pool, closePool } from "./harness";

afterAll(closePool);

type Expectation = {
  anon: boolean;
  authenticated: boolean;
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

  // --- Signed-in members only. listing_favourite_counts() (0085) is
  // --- SECURITY DEFINER because listing_favourites is readable only by the
  // --- member who saved — so the grant is half the boundary and
  // --- `l.seller_id = auth.uid()` inside the body is the other half. anon
  // --- must never reach it: an anonymous caller has no auth.uid(), so the
  // --- body would scope to nothing, but a function that takes an array of
  // --- listing ids has no business being reachable with the publishable key.
  "listing_favourite_counts(p_listing_ids bigint[])": { anon: false, authenticated: true },
  "listing_is_visible_row(target_status text, target_seller_id uuid, target_listing_id bigint)": {
    anon: true,
    authenticated: true,
  },
  "review_is_visible(p_hidden_at timestamp with time zone, p_reviewer_id uuid, p_reviewee_id uuid)": {
    anon: true,
    authenticated: true,
  },

  // --- Trigger functions — revoked from both roles in 0133. The last three
  // --- keep handicap and membership number in member_private (owner-only).
  "handle_new_user()": { anon: false, authenticated: false },
  "sync_denormalised_club_names()": { anon: false, authenticated: false },
  "validate_article_image()": { anon: false, authenticated: false },
  "profiles_private_fields()": { anon: false, authenticated: false },
  "profiles_private_row()": { anon: false, authenticated: false },
  "member_private_sync()": { anon: false, authenticated: false },

  // --- 0134, mobile numbers. The server's remove_member_phone(p_member) is
  // --- never for a browser; a member removes their own number and reads a
  // --- group's shared numbers (membership is checked inside, from auth.uid()).
  "remove_member_phone(p_member uuid)": { anon: false, authenticated: false },
  "remove_my_phone()": { anon: false, authenticated: true },
  "group_contacts(p_group_id bigint)": { anon: false, authenticated: true },

  // --- Signed-in members only. Each is safe to expose because it either takes
  // --- no caller-controlled identity, or derives identity from auth.uid().
  "are_connected(a uuid, b uuid)": { anon: false, authenticated: true },
  // 0080. Takes no parameters and derives the member from auth.uid(), so it
  // can only ever answer about the caller. SECURITY DEFINER because the
  // honest answer depends on payouts, refunds and disputes, none of which a
  // member may read under their own RLS.
  "can_delete_account()": { anon: false, authenticated: true },
  // 0140: the staff-side check for a member named by id. Service role only.
  "can_delete_account_for(p_user_id uuid)": { anon: false, authenticated: false },
  "can_message(a uuid, b uuid)": { anon: false, authenticated: true },
  "get_order_dispute_status(p_order_id bigint)": { anon: false, authenticated: true },
  "is_blocked(a uuid, b uuid)": { anon: false, authenticated: true },

  // ---- Group conversations (0087) ----
  // is_conversation_member() and conversation_has_block() are the two
  // functions every messaging policy now calls, so a signed-in member must be
  // able to execute them. Both take ids as parameters and both return a bare
  // boolean, never row data — the same reasoning as can_message()/is_blocked()
  // directly above, and the reason "authenticated can call this about any
  // conversation id" is not a leak: the answer is one bit that tells them
  // nothing they could not learn by trying to open the thread.
  "is_conversation_member(p_conversation_id bigint, p_user_id uuid)": {
    anon: false,
    authenticated: true,
  },
  "conversation_has_block(p_conversation_id bigint, p_user_id uuid)": {
    anon: false,
    authenticated: true,
  },
  // These two DO act on the caller's behalf, and each one checks eligibility
  // itself before writing (can_message for every person added, is_blocked
  // across every pair). anon must never reach them: they create rows.
  "create_group_conversation(p_title text, p_member_ids uuid[])": {
    anon: false,
    authenticated: true,
  },
  "add_conversation_member(p_conversation_id bigint, p_member_id uuid)": {
    anon: false,
    authenticated: true,
  },
  "is_staff(required_roles text[])": { anon: false, authenticated: true },
  "register_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text, p_platform text)": {
    anon: false,
    authenticated: true,
  },
  // 0077. Both derive the caller from auth.uid() and check ownership against
  // it — the host for one, the requester for the other — so being callable
  // by a signed-in member is exactly the intent. They exist as SECURITY
  // DEFINER functions so the space count can be changed under a row lock.
  "respond_to_tee_time_interest(p_interest_id bigint, p_accept boolean)": { anon: false, authenticated: true },
  "confirm_tee_time_place(p_interest_id bigint, p_attending boolean)": { anon: false, authenticated: true },
  "rejoin_tee_time(p_invite_id bigint)": { anon: false, authenticated: true },
  "withdraw_tee_time_request(p_interest_id bigint)": { anon: false, authenticated: true },
  // 0078. Takes an invite id but derives the member from auth.uid(), so it
  // answers only about the caller's own confirmed status — walking every
  // invite id tells an attacker nothing they did not already know about
  // themselves. SECURITY DEFINER because the tee_time_interests SELECT policy
  // calls it while reading tee_time_interests, and an inline subquery there
  // would recurse.
  "has_confirmed_place(target_invite_id bigint)": { anon: false, authenticated: true },
  // 0088. Answers only "may the CALLER see this post" — auth.uid() is read
  // inside, never passed in. SECURITY DEFINER so the policies on
  // post_images, post_likes, post_comments and storage.objects can share one
  // answer, and so the block check sees both directions.
  "can_view_post(target_post_id bigint)": { anon: false, authenticated: true },
  // 0101. A number, never who; null across a block.
  "member_pinpal_count(target_member_id uuid)": { anon: false, authenticated: true },
  // 0103 live scoring. Each write function checks the caller is in the
  // round (or, for cards, signed in) itself; none is for anon. The two
  // broadcast triggers are callable by no one.
  "can_view_live_round(p_round_id bigint)": { anon: false, authenticated: true },
  "course_card_save(p_club_id bigint, p_tee_name text, p_holes smallint, p_par_total smallint, p_course_rating numeric, p_slope smallint, p_card jsonb)": { anon: false, authenticated: true },
  "live_round_broadcast()": { anon: false, authenticated: false },
  "live_round_create(p_round jsonb, p_players jsonb, p_card jsonb)": { anon: false, authenticated: true },
  // 0157: one open game per player — two triggers, and your own open game.
  "live_game_start_lock()": { anon: false, authenticated: false },
  "live_round_players_one_open_game()": { anon: false, authenticated: false },
  "my_open_live_game()": { anon: false, authenticated: true },
  "live_round_finish(p_round_id bigint)": { anon: false, authenticated: true },
  "live_round_set_hole(p_round_id bigint, p_hole smallint, p_par smallint, p_stroke_index smallint)": { anon: false, authenticated: true },
  "live_round_set_score(p_round_id bigint, p_player_id bigint, p_hole smallint, p_strokes smallint, p_clear boolean)": { anon: false, authenticated: true },
  // 0155: the lock screen's save, called by the website as the service role
  // after checking a signed key. It takes the member as a parameter, so it
  // must never be reachable by a member or with the publishable key.
  "live_round_set_own_score(p_member uuid, p_round_id bigint, p_hole smallint, p_strokes smallint, p_clear boolean)": { anon: false, authenticated: false },
  // 0185 watch v2: the group's scores from a watch, same key and same boundary.
  "live_round_set_scores_as(p_member uuid, p_round_id bigint, p_hole smallint, p_scores jsonb)": { anon: false, authenticated: false },
  "live_highlight_set_muted(p_round_id bigint, p_muted boolean)": { anon: false, authenticated: true },
  // 0161 live activity: the website records pings and reads the admin's live
  // numbers as the service role. record_activity takes the member as a
  // parameter, so neither may be reachable with a member's token or anon.
  "record_activity(p_session text, p_member uuid, p_platform text, p_section text, p_view boolean, p_install text, p_app_version text)": { anon: false, authenticated: false },
  "admin_live_stats(p_tz text)": { anon: false, authenticated: false },
  // 0158 follow my round. Each checks whose card it is (or whose share) itself.
  "live_follow_share(p_player_id bigint, p_followers uuid[], p_token_hash text)": { anon: false, authenticated: true },
  "live_follow_stop(p_follow_id bigint)": { anon: false, authenticated: true },
  // A trigger: a guest's seat claimed by a member stops others' shares of it.
  "live_round_player_claimed_stops_follows()": { anon: false, authenticated: false },
  "live_round_status_broadcast()": { anon: false, authenticated: false },
  // 0180: saves every member's card when a round finishes. Trigger-only.
  "live_round_finish_cards()": { anon: false, authenticated: false },
  // 0104 match days. Same reasoning: each checks the caller itself.
  "can_score_live_round(p_round_id bigint)": { anon: false, authenticated: true },
  "can_view_match_day(p_day_id bigint)": { anon: false, authenticated: true },
  "live_match_day_create(p_day jsonb, p_matches jsonb, p_card jsonb)": { anon: false, authenticated: true },
  // 0105 deleting. Each checks the caller started the round / organised the day.
  "live_match_day_delete(p_day_id bigint)": { anon: false, authenticated: true },
  "live_round_set_drive(p_round_id bigint, p_hole smallint, p_position smallint)": { anon: false, authenticated: true },
  "live_round_set_team_handicap(p_round_id bigint, p_handicap integer)": { anon: false, authenticated: true },
  "live_scramble_day_create(p_day jsonb, p_teams jsonb, p_card jsonb)": { anon: false, authenticated: true },
  // 0137 competition results. Each checks the caller organised the day
  // (or, for card status, is in it) itself.
  "competition_results_save(p_day_id bigint, p_settings jsonb)": { anon: false, authenticated: true },
  "competition_results_publish(p_day_id bigint, p_results jsonb)": { anon: false, authenticated: true },
  "competition_results_withdraw(p_day_id bigint)": { anon: false, authenticated: true },
  "competition_card_status(p_day_id bigint)": { anon: false, authenticated: true },
  // 0138: results on a group's page. Each checks the caller organised the day.
  "competition_results_set_group(p_day_id bigint, p_group_id bigint)": { anon: false, authenticated: true },
  "competition_results_group_suggestion(p_day_id bigint)": { anon: false, authenticated: true },
  "order_set_meetup(p_order_id bigint, p_at timestamp with time zone, p_place text)": { anon: false, authenticated: true },
  "order_confirm_handover(p_order_id bigint, p_code text)": { anon: false, authenticated: true },
  "order_mark_posted(p_order_id bigint, p_tracking text)": { anon: false, authenticated: true },
  "order_confirm_received(p_order_id bigint)": { anon: false, authenticated: true },
  "order_flag_problem(p_order_id bigint)": { anon: false, authenticated: true },
  "orders_handover_code_on_paid()": { anon: false, authenticated: false },
  "store_apply(p_name text, p_club_id bigint, p_description text, p_phone text, p_email text, p_fittings boolean)": { anon: false, authenticated: true },
  "store_update(p_store_id bigint, p_description text, p_phone text, p_email text, p_fittings boolean, p_logo_url text, p_cover_url text)": { anon: false, authenticated: true },
  "listings_check_store()": { anon: false, authenticated: false },
  // 0164: counts what sellers type when their brand or model isn't listed.
  "listings_catalogue_vote()": { anon: false, authenticated: false },
  // 0164: learns a model or brand once 5 sellers typed it — trigger-only.
  "marketplace_learn(p_kind text, p_brand text, p_category text, p_key text)": { anon: false, authenticated: false },
  "connect_members(p_a uuid, p_b uuid)": { anon: false, authenticated: false },
  "my_invite_code()": { anon: false, authenticated: true },
  "invite_preview(p_code text)": { anon: true, authenticated: true },
  "connect_by_invite(p_code text)": { anon: false, authenticated: true },
  "dismiss_member_suggestion(p_member uuid)": { anon: false, authenticated: true },
  "member_suggestions(p_limit integer)": { anon: false, authenticated: true },
  // Junior members (0159). The wrapped originals and the age helpers are
  // internal; the parent's page previews/declines by link before sign-in.
  "member_suggestions_all(p_limit integer)": { anon: false, authenticated: false },
  "ads_for_me_all(p_country text, p_region text, p_club_id bigint)": { anon: false, authenticated: false },
  "age_band_of(p_user uuid)": { anon: false, authenticated: false },
  "age_guard()": { anon: false, authenticated: false },
  "is_minor(p_user uuid)": { anon: false, authenticated: false },
  "is_under_16(p_user uuid)": { anon: false, authenticated: false },
  "guardian_of(p_junior uuid)": { anon: false, authenticated: false },
  "junior_may_play_with(p_junior uuid, p_other uuid)": { anon: false, authenticated: false },
  "mask_junior_surname()": { anon: false, authenticated: false },
  "member_age_from_signup()": { anon: false, authenticated: false },
  "member_age_signup_stash()": { anon: false, authenticated: false },
  "member_birthdates_after()": { anon: false, authenticated: false },
  "member_birthdates_guard()": { anon: false, authenticated: false },
  "guardian_link_card_checked(p_link_id bigint, p_guardian uuid)": { anon: false, authenticated: false },
  "guardian_link_reissue(p_junior uuid, p_email text, p_token_hash text)": { anon: false, authenticated: false },
  "can_see_minor(p_minor uuid)": { anon: false, authenticated: true },
  "profile_visible_to_me(p_id uuid)": { anon: false, authenticated: true },
  "my_is_minor()": { anon: false, authenticated: true },
  "my_age_access()": { anon: false, authenticated: true },
  "set_my_date_of_birth(p_date date)": { anon: false, authenticated: true },
  "my_children()": { anon: false, authenticated: true },
  "guardian_link_accept(p_token_hash text)": { anon: false, authenticated: true },
  "guardian_link_revoke(p_link_id bigint)": { anon: false, authenticated: true },
  "junior_contact_set(p_junior uuid, p_contact uuid, p_on boolean)": { anon: false, authenticated: true },
  "junior_contact_list(p_junior uuid)": { anon: false, authenticated: true },
  "report_store_age_signal(p_platform text, p_lower integer, p_upper integer, p_status text)": { anon: false, authenticated: true },
  "admin_set_age_flag(p_user uuid, p_on boolean, p_note text)": { anon: false, authenticated: true },
  "guardian_link_preview(p_token_hash text)": { anon: true, authenticated: true },
  "guardian_link_decline(p_token_hash text)": { anon: true, authenticated: true },
  // 0160 cash marketplace. The switch and a member's record are public, as
  // the listing pages that show them are; the sale writes are members' own;
  // the helpers are internal.
  "marketplace_payments_enabled()": { anon: true, authenticated: true },
  "can_message_about_listing(a uuid, b uuid, p_listing_id bigint)": { anon: false, authenticated: true },
  "marketplace_feedback_revealed(p_sale_id bigint)": { anon: false, authenticated: false },
  "marketplace_short_name(p_member uuid)": { anon: false, authenticated: false },
  "mark_listing_sold(p_listing_id bigint, p_buyer_id uuid, p_final_price_cents integer)": { anon: false, authenticated: true },
  "leave_marketplace_feedback(p_sale_id bigint, p_positive boolean, p_tags text[], p_body text)": { anon: false, authenticated: true },
  "decline_marketplace_sale(p_sale_id bigint)": { anon: false, authenticated: true },
  "marketplace_possible_buyers(p_listing_id bigint)": { anon: false, authenticated: true },
  "marketplace_sale_summary(p_sale_id bigint)": { anon: false, authenticated: true },
  "marketplace_member_stats(p_member uuid)": { anon: true, authenticated: true },
  "marketplace_member_feedback(p_member uuid, p_limit integer, p_before_id bigint)": { anon: true, authenticated: true },
  // --- Public questions & offers on a listing (0162). The thread is public
  // --- like the listing (anon reads it); every write takes its identity from
  // --- auth.uid(). listing_for_public_post() takes a member id, so it stays
  // --- internal, as does the trigger that closes offers when a listing sells.
  "listing_public_posts(p_listing_id bigint)": { anon: true, authenticated: true },
  // 0164: what 3+ sellers typed, offered to the next seller — labels and counts only.
  "marketplace_member_suggestions(p_category text, p_brand text)": { anon: true, authenticated: true },
  "post_listing_question(p_listing_id bigint, p_body text)": { anon: false, authenticated: true },
  "post_listing_offer(p_listing_id bigint, p_amount_cents integer, p_note text)": { anon: false, authenticated: true },
  "reply_to_listing_post(p_post_id bigint, p_body text)": { anon: false, authenticated: true },
  "answer_listing_offer(p_post_id bigint, p_action text, p_counter_cents integer, p_note text)": { anon: false, authenticated: true },
  "withdraw_listing_offer(p_post_id bigint)": { anon: false, authenticated: true },
  "remove_listing_post(p_post_id bigint)": { anon: false, authenticated: true },
  "listing_for_public_post(p_listing_id bigint, p_me uuid)": { anon: false, authenticated: false },
  "close_public_offers_on_listing_change()": { anon: false, authenticated: false },
  "member_affinity(p_other uuid)": { anon: false, authenticated: true },
  "played_with_me(p_days integer)": { anon: false, authenticated: true },
  "round_guest_invite(p_player_id bigint)": { anon: false, authenticated: true },
  "claim_round_guest(p_token text)": { anon: false, authenticated: true },
  "orders_store_pricing()": { anon: false, authenticated: false },
  "orders_return_stock()": { anon: false, authenticated: false },
  "banner_seen(p_banner_id bigint)": { anon: true, authenticated: true },
  "banner_clicked(p_banner_id bigint)": { anon: true, authenticated: true },
  "affiliate_clicked(p_product_id bigint, p_source text)": { anon: true, authenticated: true },
  // 0139 advertising. Both reachable by visitors on purpose: adverts are
  // public, and a signed-out website view is counted (flagged, never billed).
  // ads_for_me() returns display fields only; ad_log() writes nothing a
  // caller chooses beyond kind/source, and de-duplicates by auth.uid().
  "ads_for_me(p_country text, p_region text, p_club_id bigint)": { anon: true, authenticated: true },
  "ad_log(p_campaign_id bigint, p_kind text, p_source text)": { anon: true, authenticated: true },

  // --- Memberships (0156). my_membership() / my_feature_access() answer for
  // --- auth.uid() only and need a signed-in member. membership_tier_for()
  // --- takes any member id, so only the service role and the two functions
  // --- above (as owner) may call it.
  "my_membership()": { anon: false, authenticated: true },
  "my_feature_access()": { anon: false, authenticated: true },
  "membership_tier_for(p_member uuid)": { anon: false, authenticated: false },
  "live_round_delete(p_round_id bigint)": { anon: false, authenticated: true },
  // 0108 hole maps
  "course_layout_get(p_club_id bigint)": { anon: false, authenticated: true },
  // 0152: super admins fix a hole's green / tee from the hole map (checked inside)
  "course_layout_fix_hole(p_layout_id bigint, p_hole smallint, p_green jsonb, p_tee jsonb)": { anon: false, authenticated: true },
  // 0153: My bag, club tags on shots, local knowledge — all scoped to auth.uid() inside
  "my_bag()": { anon: false, authenticated: true },
  "my_longest_shots(p_round_id bigint)": { anon: false, authenticated: true },
  "live_round_shot_club(p_round_id bigint, p_player_id bigint, p_hole smallint, p_shot_no smallint, p_club text, p_distance_m numeric)": { anon: false, authenticated: true },
  "hole_tips_for(p_club_id bigint, p_hole smallint)": { anon: false, authenticated: true },
  // 0149 course cards, one club at a time
  "course_cards_for_club(p_club_id bigint)": { anon: false, authenticated: true },
  "live_round_shot_add(p_round_id bigint, p_player_id bigint, p_hole smallint, p_lat double precision, p_lng double precision, p_accuracy_m numeric)": { anon: false, authenticated: true },
  "live_round_shot_undo(p_round_id bigint, p_player_id bigint, p_hole smallint)": { anon: false, authenticated: true },
  "live_round_player_forget_shots()": { anon: false, authenticated: false },
  // 0109
  "golfapi_import_secret_ok(p_secret text)": { anon: false, authenticated: false },
  // 0168 hole map competition mode — false for anyone not in the round
  "live_round_is_competition(p_round_id bigint)": { anon: false, authenticated: true },
  // 0169 the website address the scheduled jobs call — database only
  "pinpals_site_url()": { anon: false, authenticated: false },
  // 0178 My Game stats — the caller's own rows only
  "my_hole_stats_set(p_live_round_id bigint, p_scorecard_id bigint, p_hole smallint, p_putts smallint, p_tee text, p_green_miss text, p_penalties smallint)": { anon: false, authenticated: true },
  // 0179 the same, with the first putt's distance
  "my_hole_stats_set(p_live_round_id bigint, p_scorecard_id bigint, p_hole smallint, p_putts smallint, p_tee text, p_green_miss text, p_penalties smallint, p_first_putt text)": { anon: false, authenticated: true },
  // 0110 scorecards
  "scorecard_visible_row(p_member uuid, p_visibility text)": { anon: false, authenticated: true },
  "scorecard_save(p_id bigint, p_card jsonb, p_holes jsonb)": { anon: false, authenticated: true },
  "scorecard_from_live_round(p_round_id bigint)": { anon: false, authenticated: true },
  // 0180: the body of the above for a given member — server-only (trigger, backfill).
  "scorecard_from_live_round_for(p_round_id bigint, p_member uuid)": { anon: false, authenticated: false },
  // 0177: the draw reads a group's men's/women's ratings answers; it checks
  // the caller can put the group on cards itself.
  "group_ratings_categories(p_group_id bigint)": { anon: false, authenticated: true },
  // 0120 groups (step B)
  "is_group_member(p_group_id bigint, p_user_id uuid)": { anon: false, authenticated: true },
  "group_role(p_group_id bigint, p_user_id uuid)": { anon: false, authenticated: true },
  "create_group(p_kind text, p_name text, p_about text, p_club_id bigint, p_starts_on date, p_ends_on date)": { anon: false, authenticated: true },
  "update_group(p_group_id bigint, p_name text, p_about text, p_members_can_invite boolean, p_club_id bigint, p_starts_on date, p_ends_on date)": { anon: false, authenticated: true },
  "delete_group(p_group_id bigint)": { anon: false, authenticated: true },
  "invite_to_group(p_group_id bigint, p_member_ids uuid[])": { anon: false, authenticated: true },
  "respond_group_invitation(p_group_id bigint, p_accept boolean)": { anon: false, authenticated: true },
  "request_to_join_group(p_group_id bigint)": { anon: false, authenticated: true },
  "withdraw_group_request(p_group_id bigint)": { anon: false, authenticated: true },
  "review_group_request(p_group_id bigint, p_member_id uuid, p_approve boolean)": { anon: false, authenticated: true },
  "group_invite_code(p_group_id bigint)": { anon: false, authenticated: true },
  "reset_group_invite_code(p_group_id bigint)": { anon: false, authenticated: true },
  // The website's /join/g/<code> page shows this before anyone signs in.
  "group_invite_preview(p_code text)": { anon: true, authenticated: true },
  "join_group_by_code(p_code text)": { anon: false, authenticated: true },
  "leave_group(p_group_id bigint)": { anon: false, authenticated: true },
  "remove_group_member(p_group_id bigint, p_member_id uuid)": { anon: false, authenticated: true },
  "set_group_role(p_group_id bigint, p_member_id uuid, p_role text)": { anon: false, authenticated: true },
  "set_group_muted(p_group_id bigint, p_muted boolean)": { anon: false, authenticated: true },
  // Internal steps of the functions above, and their trigger.
  "group_blocked_by_admins(p_group_id bigint, p_user_id uuid)": { anon: false, authenticated: false },
  "group_add_member(p_group_id bigint, p_user_id uuid)": { anon: false, authenticated: false },
  "group_sync_chat(p_group_id bigint)": { anon: false, authenticated: false },
  "group_members_after_change()": { anon: false, authenticated: false },
  // 0121 rounds from a group and the society day
  "live_can_add_player(p_me uuid, p_member uuid)": { anon: false, authenticated: false },
  "live_can_add_player_all(p_me uuid, p_member uuid)": { anon: false, authenticated: false },
  "live_fourball_day_create(p_day jsonb, p_groups jsonb, p_card jsonb)": { anon: false, authenticated: true },
  // 0122 society officers and handicaps
  "set_group_office(p_group_id bigint, p_member_id uuid, p_office text)": { anon: false, authenticated: true },
  "my_handicap_indicator()": { anon: false, authenticated: true },
  "my_handicap_differentials()": { anon: false, authenticated: true },
  "society_handicaps(p_group_id bigint)": { anon: false, authenticated: true },
  "set_society_handicap(p_group_id bigint, p_member_id uuid, p_index numeric)": { anon: false, authenticated: true },
  // Read anyone's scorecards: only through the wrappers above, which decide whose.
  "handicap_differentials_of(p_member uuid)": { anon: false, authenticated: false },
  "handicap_indicator_of(p_member uuid)": { anon: false, authenticated: false },
  // 0124 group cover and logo
  "set_group_image(p_group_id bigint, p_which text, p_url text)": { anon: false, authenticated: true },
  "group_can_style(p_group_id bigint, p_user_id uuid)": { anon: false, authenticated: false },
  // 0125 society outings
  "outing_officer(p_group_id bigint, p_user_id uuid)": { anon: false, authenticated: true },
  "save_outing(p_group_id bigint, p_id bigint, p jsonb)": { anon: false, authenticated: true },
  "cancel_outing(p_outing_id bigint)": { anon: false, authenticated: true },
  "set_outing_entry(p_outing_id bigint, p_in boolean, p_member uuid)": { anon: false, authenticated: true },
  "publish_outing_draw(p_outing_id bigint, p_groups jsonb)": { anon: false, authenticated: true },
  "link_outing_match_day(p_outing_id bigint, p_match_day_id bigint)": { anon: false, authenticated: true },
  // 0184 a society day's saved live set-up
  "save_outing_live_setup(p_outing_id bigint, p_setup jsonb)": { anon: false, authenticated: true },
  // 0187 multi-day championships
  "save_championship(p_group_id bigint, p_id bigint, p jsonb)": { anon: false, authenticated: true },
  "cancel_championship(p_id bigint)": { anon: false, authenticated: true },
  "set_championship_entry(p_id bigint, p_in boolean, p_member uuid)": { anon: false, authenticated: true },
  "set_trip_championship(p_outing_id bigint, p_on boolean, p_rule text)": { anon: false, authenticated: true },
  "link_outing_item_match_day(p_item_id bigint, p_match_day_id bigint)": { anon: false, authenticated: true },
  "mark_outing_paid(p_outing_id bigint, p_member uuid, p_status text)": { anon: false, authenticated: true },
  // 0128 scorecard certification
  "scorecard_certify_candidates(p_scorecard_id bigint)": { anon: false, authenticated: true },
  "scorecard_certify_request(p_scorecard_id bigint, p_certifier uuid)": { anon: false, authenticated: true },
  "scorecard_certification_open(p_id bigint)": { anon: false, authenticated: true },
  "my_certification_requests()": { anon: false, authenticated: true },
  "scorecard_certify_key_register(p_platform text)": { anon: false, authenticated: true },
  "scorecard_certify_key_confirm(p_key_id uuid)": { anon: false, authenticated: true },
  "scorecard_certify(p_id bigint, p_key_id uuid, p_signature text, p_method text)": { anon: false, authenticated: true },
  "scorecard_certification_query(p_id bigint, p_hole smallint, p_note text)": { anon: false, authenticated: true },
  "scorecard_certification_decline(p_id bigint)": { anon: false, authenticated: true },
  // 0130 chat reactions, replies, deletes
  "react_to_message(p_message_id bigint, p_emoji text)": { anon: false, authenticated: true },
  // 0166: counts a share of a post the caller can see; the count is all it reveals.
  "record_post_share(p_post_id bigint, p_channel text)": { anon: false, authenticated: true },
  "hide_message_for_me(p_message_id bigint)": { anon: false, authenticated: true },
  "delete_message_for_everyone(p_message_id bigint)": { anon: false, authenticated: true },
  "start_private_reply(p_message_id bigint)": { anon: false, authenticated: true },
  "message_reply_snapshot()": { anon: false, authenticated: false },
  "message_scrub_quotes()": { anon: false, authenticated: false },
  "conversation_read_ping()": { anon: false, authenticated: false },
  // Internal steps and triggers: nobody calls these directly.
  "scorecard_card_hash(p_scorecard_id bigint)": { anon: false, authenticated: false },
  "scorecard_certification_for_answer(p_id bigint)": { anon: false, authenticated: false },
  "scorecard_certifications_check_card()": { anon: false, authenticated: false },
  "scorecard_certifications_former_member()": { anon: false, authenticated: false },
  // 0126 trip itineraries
  "save_outing_item(p_outing_id bigint, p_id bigint, p jsonb)": { anon: false, authenticated: true },
  "delete_outing_item(p_item_id bigint)": { anon: false, authenticated: true },
  "set_outing_item_people(p_item_id bigint, p_people jsonb)": { anon: false, authenticated: true },
  // 0127 payment details and "I've paid"
  "claim_outing_paid(p_outing_id bigint, p_method text, p_member uuid)": { anon: false, authenticated: true },
  // A trigger: leaving a trip takes you off its flights, rooms and groups.
  "outing_entry_left()": { anon: false, authenticated: false },
  // 0131 guests on events. outing_entry_count is only called from the
  // functions above it, so nobody may call it directly.
  "add_outing_guest(p_outing_id bigint, p_name text, p_index numeric)": { anon: false, authenticated: true },
  "update_outing_guest(p_guest_id bigint, p_name text, p_index numeric)": { anon: false, authenticated: true },
  "remove_outing_guest(p_guest_id bigint)": { anon: false, authenticated: true },
  "mark_outing_guest_paid(p_guest_id bigint, p_status text)": { anon: false, authenticated: true },
  "outing_entry_count(p_outing_id bigint)": { anon: false, authenticated: false },
  // 0142 society entries: requests, the waiting list and the alert outbox.
  // The helpers and the outbox writer are internal; members call only the
  // four actions, the closed check and their own place in the line.
  "queue_society_alert(p_group_id bigint, p_outing_id bigint, p_member uuid, p_kind text, p_payload jsonb, p_dedupe text)": { anon: false, authenticated: false },
  "outing_officer_ids(p_group_id bigint)": { anon: false, authenticated: false },
  "outing_entries_closed(p_outing_id bigint)": { anon: false, authenticated: true },
  "outing_free_places(p_outing_id bigint)": { anon: false, authenticated: false },
  "outing_seat_from_queue(p_queue_id bigint, p_with_guest boolean, p_by uuid)": { anon: false, authenticated: false },
  "offer_outing_places(p_outing_id bigint)": { anon: false, authenticated: false },
  "expire_outing_offers(p_outing_id bigint)": { anon: false, authenticated: false },
  "sweep_outing_offers()": { anon: false, authenticated: false },
  "save_outing_choices(o society_outings, p_member uuid, p jsonb)": { anon: false, authenticated: false },
  "request_outing_place(p_outing_id bigint, p jsonb)": { anon: false, authenticated: true },
  "review_outing_request(p_outing_id bigint, p_member uuid, p_decision text)": { anon: false, authenticated: true },
  "answer_outing_offer(p_outing_id bigint, p_accept boolean)": { anon: false, authenticated: true },
  "promote_outing_waiting(p_outing_id bigint, p_member uuid)": { anon: false, authenticated: true },
  "my_outing_queue(p_group_id bigint)": { anon: false, authenticated: true },
  "mark_outing_refunded(p_outing_id bigint, p_member uuid, p_refunded boolean)": { anon: false, authenticated: true },
  "society_outing_alerts()": { anon: false, authenticated: false },
  "society_outing_cancelled_clear()": { anon: false, authenticated: false },
  "society_entry_blocked(p_group_id bigint, p_member uuid)": { anon: false, authenticated: false },
  "outing_entry_rejoined()": { anon: false, authenticated: false },
  "society_audience_allowed(p_group_id bigint, p_user uuid, p_audience text)": { anon: false, authenticated: false },
  // 0143 noticeboard, alert settings, messages, reminders. The audience
  // resolver and the sweep are internal.
  "set_society_alert_pref(p_group_id bigint, p_kind text, p_enabled boolean)": { anon: false, authenticated: true },
  "society_can_message(p_group_id bigint, p_user uuid)": { anon: false, authenticated: true },
  "save_society_notice(p_group_id bigint, p_id bigint, p jsonb)": { anon: false, authenticated: true },
  "delete_society_notice(p_id bigint)": { anon: false, authenticated: true },
  "society_audience(p_group_id bigint, p_audience text, p_outing_id bigint)": { anon: false, authenticated: false },
  "society_audience_count(p_group_id bigint, p_audience text, p_outing_id bigint)": { anon: false, authenticated: true },
  "send_society_message(p_group_id bigint, p_audience text, p_outing_id bigint, p_title text, p_body text, p_post_notice boolean)": { anon: false, authenticated: true },
  "society_reminder_sweep()": { anon: false, authenticated: false },
  // 0144 committee roles, annual membership, the treasurer. membership_status
  // is internal (it reads other members' payments).
  "society_can(p_group_id bigint, p_user uuid, p_area text)": { anon: false, authenticated: true },
  "my_society_areas(p_group_id bigint)": { anon: false, authenticated: true },
  "outing_money_officer(p_group_id bigint, p_user_id uuid)": { anon: false, authenticated: true },
  "my_society_handicap(p_group_id bigint)": { anon: false, authenticated: true },
  "membership_billing_season(p_group_id bigint)": { anon: false, authenticated: true },
  "membership_status(p_group_id bigint, p_member uuid, p_season smallint)": { anon: false, authenticated: false },
  "save_membership_settings(p_group_id bigint, p jsonb)": { anon: false, authenticated: true },
  "mark_membership(p_group_id bigint, p_member uuid, p_season smallint, p_status text, p_method text)": { anon: false, authenticated: true },
  "claim_membership_paid(p_group_id bigint, p_method text, p_member uuid)": { anon: false, authenticated: true },
  "my_society_dues(p_group_id bigint)": { anon: false, authenticated: true },
  "society_money(p_group_id bigint, p_season smallint)": { anon: false, authenticated: true },
  "society_payment_claims(p_group_id bigint)": { anon: false, authenticated: true },
  "society_member_list(p_group_id bigint)": { anon: false, authenticated: true },
  "remind_membership(p_group_id bigint, p_member uuid)": { anon: false, authenticated: true },
  // 0145 order of merit rules.
  "save_order_of_merit(p_group_id bigint, p jsonb)": { anon: false, authenticated: true },
  // 0132 filling an open place. The link claim is the website's, after it
  // has checked the link's signature — never callable from the app.
  "tee_time_invited(p_invite_id bigint)": { anon: false, authenticated: true },
  "tee_time_can_fill(p_invite_id bigint, p_user uuid)": { anon: false, authenticated: true },
  "tee_time_participant(p_invite_id bigint)": { anon: false, authenticated: true },
  "invite_to_tee_time(p_invite_id bigint, p_members uuid[])": { anon: false, authenticated: true },
  "tee_time_link_claim(p_invite_id bigint, p_sharer uuid, p_member uuid)": { anon: false, authenticated: false },
  // 0186: invite your group; take a place in one tap; can't make it.
  "invite_group_to_tee_time(p_invite_id bigint, p_group_id bigint)": { anon: false, authenticated: true },
  "take_tee_time_place(p_invite_id bigint)": { anon: false, authenticated: true },
  "pass_tee_time_place(p_invite_id bigint)": { anon: false, authenticated: true },

  // --- Service role / internal only. Everything below is either a trigger
  // --- function, a sweep, or a privileged write path that must never be
  // --- reachable from a browser.
  "admin_distinct_webhook_event_types()": { anon: false, authenticated: false },
  "apply_new_bid()": { anon: false, authenticated: false },
  // 0093. Course rating roll-up: a trigger function and the helper it calls.
  // DEFINER because members cannot update clubs, which is why neither may be
  // called directly — a member could otherwise recompute (harmless) or, with
  // a future change, write to clubs.
  "course_reviews_after_change()": { anon: false, authenticated: false },
  "refresh_club_rating(p_club_id bigint)": { anon: false, authenticated: false },
  // 0088. Keep posts.like_count / comment_count, which members have no
  // UPDATE grant on — that is why they must be SECURITY DEFINER.
  "bump_post_comment_count()": { anon: false, authenticated: false },
  "prepare_post_comment_reply()": { anon: false, authenticated: false },
  "bump_post_like_count()": { anon: false, authenticated: false },
  "bump_post_share_count()": { anon: false, authenticated: false },
  "posts_check_repost()": { anon: false, authenticated: false },
  "posts_repost_shared()": { anon: false, authenticated: false },
  "posts_repost_unshared()": { anon: false, authenticated: false },
  // 0097. A trigger that cleans @mentions (reads connections, blocks and
  // posts the commenter can't), and the comment-like counter (members have
  // no UPDATE on like_count). Triggers only — callable by nobody.
  "clean_post_comment_mentions()": { anon: false, authenticated: false },
  "bump_post_comment_like_count()": { anon: false, authenticated: false },
  // 0111. Keeps post_comments.emoji_counts, called only by the trigger above.
  "bump_post_comment_emoji(p_comment bigint, p_key text, p_delta integer)": { anon: false, authenticated: false },
  // 0084. The nightly sweep that closes rounds a clear day past their
  // play_date. SECURITY DEFINER so cron can run it without a session;
  // unreachable from a browser because a member closing other people's
  // rounds is not a thing that should be expressible.
  "complete_past_tee_times()": { anon: false, authenticated: false },
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
  "add_direct_conversation_members()": { anon: false, authenticated: false },
  "prevent_conversation_member_tampering()": { anon: false, authenticated: false },
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

  // --- Trust & safety (0188). The badge and the host's/golfer's own actions
  // --- are callable by members (each checks who is calling inside); the
  // --- triggers and helpers are internal.
  "member_reliability(p_members uuid[])": { anon: false, authenticated: true },
  "mark_tee_time_no_show(p_invite_id bigint, p_member uuid, p_no_show boolean)": { anon: false, authenticated: true },
  "dispute_tee_time_attendance(p_invite_id bigint, p_note text)": { anon: false, authenticated: true },
  "tee_time_starts_at(p_invite_id bigint)": { anon: false, authenticated: false },
  "played_live_that_day(p_invite_id bigint, p_member uuid)": { anon: false, authenticated: false },
  "record_late_cancel()": { anon: false, authenticated: false },
  "record_host_late_cancel()": { anon: false, authenticated: false },
  "enforce_reliable_only()": { anon: false, authenticated: false },
  "set_message_safety_flags()": { anon: false, authenticated: false },

  // --- Competitions (0148): leagues, ladders and opens. Every write a member
  // --- makes goes through these, each checking who is calling inside. The
  // --- sweep, the after-result step and the organiser list are internal.
  "competition_staff()": { anon: false, authenticated: true },
  "competition_can_view(p_league_id bigint)": { anon: false, authenticated: true },
  "competition_is_organiser(p_league_id bigint)": { anon: false, authenticated: true },
  "competition_league_save(p_id bigint, p jsonb)": { anon: false, authenticated: true },
  "competition_cancel(p_league_id bigint)": { anon: false, authenticated: true },
  "competition_enter(p_league_id bigint, p_in boolean, p_handicap numeric)": { anon: false, authenticated: true },
  "competition_mark_paid(p_league_id bigint, p_user_id uuid, p_how text)": { anon: false, authenticated: true },
  "competition_draw(p_league_id bigint, p_groups jsonb)": { anon: false, authenticated: true },
  "competition_arrange(p_match_id bigint, p_at timestamp with time zone, p_club_id bigint)": { anon: false, authenticated: true },
  "competition_report(p_match_id bigint, p_winner text, p_margin text)": { anon: false, authenticated: true },
  "competition_confirm(p_match_id bigint, p_winner text, p_margin text)": { anon: false, authenticated: true },
  "competition_dispute(p_match_id bigint, p_note text)": { anon: false, authenticated: true },
  "competition_resolve(p_match_id bigint, p_winner text, p_margin text, p_void boolean)": { anon: false, authenticated: true },
  "competition_start_knockout(p_league_id bigint, p_bracket jsonb)": { anon: false, authenticated: true },
  "competition_challenge(p_league_id bigint, p_opponent uuid)": { anon: false, authenticated: true },
  "competition_after_result(p_match_id bigint)": { anon: false, authenticated: false },
  "competition_alert(p_member uuid, p_type text, p_title text, p_body text, p_data jsonb, p_dedupe text)": { anon: false, authenticated: false },
  "competition_organisers(p_league_id bigint)": { anon: false, authenticated: false },
  "competition_settle_due()": { anon: false, authenticated: false },
  "open_competition_share(p jsonb)": { anon: false, authenticated: true },
  "open_competition_remove(p_id bigint)": { anon: false, authenticated: true },
  "open_competition_set_source(p_id bigint, p_source text)": { anon: false, authenticated: true },
  "open_partner_request_set(p_open_id bigint, p_on boolean, p_note text)": { anon: false, authenticated: true },
  // 0170: a society's member list, imported and emailed. The preview is the
  // emailed link's front page, read before signing in.
  "import_group_email_invites(p_group_id bigint, p_rows jsonb)": { anon: false, authenticated: true },
  "resend_group_email_invites(p_group_id bigint, p_ids bigint[])": { anon: false, authenticated: true },
  "mark_group_email_invites_sent(p_group_id bigint, p_ids bigint[])": { anon: false, authenticated: true },
  "cancel_group_email_invite(p_group_id bigint, p_invite_id bigint)": { anon: false, authenticated: true },
  "group_email_invite_preview(p_token text)": { anon: true, authenticated: true },
  "claim_group_email_invite(p_token text)": { anon: false, authenticated: true },
  "claim_group_email_invites_for(p_user uuid, p_email text)": { anon: false, authenticated: false },
  "on_auth_user_email_invites()": { anon: false, authenticated: false },
  // 0174: a secret leaderboard until the prize-giving.
  "live_day_organiser(p_day_id bigint, p_user uuid)": { anon: false, authenticated: false },
  "live_day_is_organiser(p_day_id bigint)": { anon: false, authenticated: true },
  "set_day_leaderboard_hidden(p_day_id bigint, p_hidden boolean)": { anon: false, authenticated: true },
  "competition_results_reveal()": { anon: false, authenticated: false },
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
