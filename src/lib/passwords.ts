/**
 * The one definition of what a Pinpals password has to be.
 *
 * ============ This applies to SETTING a password, never to signing in ============
 *
 * Read that again before using anything in this file, because getting it
 * wrong locks members out of their own accounts.
 *
 * Sign-up and password reset are the two places a password is CHOSEN, and
 * they are the only two places this minimum belongs. Sign-in verifies a
 * hash that was written under whatever rules applied on the day it was set;
 * a member whose password predates a tightening must still be able to log
 * in with it, and Supabase Auth is explicit that they can — strengthened
 * requirements apply at sign-up and password change, not at sign-in.
 *
 * `src/app/login/actions.ts` therefore imports nothing from here, and must
 * not start. Adding a length check to the login path would sign out every
 * member whose password is shorter than whatever the current minimum
 * happens to be, with no way back in except a reset — which is the precise
 * failure mode this comment exists to prevent.
 *
 * ============ Why 10, and why one constant ============
 *
 * Supabase's default is 6, which is below every current recommendation,
 * and Pinpals now holds order history, message threads, payout details and
 * a phone number behind a single password with no second factor available
 * to members.
 *
 * It lives here rather than in each form because it previously did not:
 * sign-up was raised to 10 while reset-password stayed at 6, which would
 * have let a member set an 8-character password past our own validation and
 * then be rejected by Supabase with an error we don't control the wording
 * of. One constant, imported by both, cannot drift like that.
 *
 * ============ Keep this in step with the Supabase Auth setting ============
 *
 * This is application-level validation. It governs our two forms and
 * nothing else — a password set through a Supabase dashboard invite, or by
 * any future flow, is governed only by the project's own Auth setting.
 * That setting should be raised to match. Note that leaked-password
 * protection (HaveIBeenPwned) is a Pro-plan feature and the project is
 * currently on Free, so it is not available to turn on yet.
 */

export const MIN_PASSWORD_LENGTH = 10;

/** The hint shown under a new-password field. Kept beside the rule it describes. */
export const PASSWORD_HINT = `At least ${MIN_PASSWORD_LENGTH} characters. A few words strung together beats a short, clever one.`;

/**
 * Returns a message explaining why a proposed password is unacceptable, or
 * null when it is fine. Shared by the sign-up action, the reset action and
 * the reset form so all three say the same thing.
 *
 * Deliberately checks length only. Composition rules — a digit, a symbol, a
 * capital — measurably push people toward `Password1!` and toward reusing
 * one password everywhere, which is a worse outcome than a long passphrase
 * of plain words.
 */
export function passwordProblem(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Your password needs to be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  return null;
}

/**
 * True when two entries of a new password don't match. Trivial, but it
 * keeps the reset form and its action from wording the same failure two
 * different ways.
 */
export const PASSWORD_MISMATCH_MESSAGE = "The two passwords don't match — please retype them.";
