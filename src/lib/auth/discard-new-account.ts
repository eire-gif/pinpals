import "server-only";
import type { User } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { revokeAppleSignIn } from "@/lib/apple-sign-in";

/**
 * "Already have a PinPals account? Use that instead" (Oct 2026,
 * claude/social-sign-in.md).
 *
 * Someone taps Continue with Apple, hides their email, and Apple's relay
 * address doesn't match the account they already have — so a second, empty
 * account is made. On Finish joining they can say so: this removes the new
 * one, and they log in to their real account and connect Apple there.
 *
 * Only ever an account that is plainly brand new and unused: joined with
 * Apple or Google (no password), within the last week, and still held for a
 * date of birth (0193) — which means it has never been able to post, join,
 * score or message anything.
 */
export const DISCARD_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** The checks that need only the user record. Exported for its test. */
export function discardableUser(user: Pick<User, "app_metadata" | "created_at">, now = Date.now()): boolean {
  const meta = user.app_metadata ?? {};
  const providers: unknown[] = Array.isArray(meta.providers) ? meta.providers : [meta.provider];
  const socialOnly = providers.length > 0 && providers.every((p) => p === "apple" || p === "google");
  const created = new Date(user.created_at).getTime();
  return socialOnly && Number.isFinite(created) && now - created < DISCARD_WINDOW_MS;
}

export type DiscardResult = { ok: true } | { ok: false; error: string };

export async function discardNewAccount(user: User): Promise<DiscardResult> {
  const notThis = "This account can't be removed here. To delete it, use Delete account in your profile.";
  if (!discardableUser(user)) return { ok: false, error: notThis };

  const admin = createAdminClient();
  const { data: held } = await admin
    .from("member_dob_required")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle<{ user_id: string }>();
  if (!held) return { ok: false, error: notThis };

  // So Apple forgets PinPals and asks about the email again next time.
  await revokeAppleSignIn(user.id);

  const { error } = await admin.auth.admin.deleteUser(user.id);
  if (error) {
    console.warn(`[discard-new-account] ${user.id}: ${error.message}`);
    return { ok: false, error: "Couldn't do that just now. Please try again." };
  }
  return { ok: true };
}
