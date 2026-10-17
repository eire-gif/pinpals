import "server-only";
import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { escapeHtml, sendEmail } from "@/lib/email";
import { getSiteUrl } from "@/lib/site-url";
import { checkParentEmail, JUNIOR_CAN, JUNIOR_CANNOT, parseAgeAccess, type AgeAccess } from "@/lib/junior";
import { newParentToken } from "@/lib/parent-link-token";

/**
 * Junior members (0159), the website's server half. Three jobs:
 *
 *   getAgeAccess()      what the signed-in member may do, from
 *                       `my_age_access()` — once per request (React cache),
 *                       however many components ask.
 *   sendParentEmail()   the "<First name> wants to join PinPals" email.
 *   reissueParentLink() a junior's new or changed parent email: a fresh
 *                       secret, the old pending link revoked, the email sent.
 *
 * Pages hide what a member can't use; the database (`age_guard()`) is what
 * actually refuses it. A failure to read the access here is treated as "no
 * restrictions to show" — the triggers still hold.
 */

/** The signed-in member's age access, or null when signed out (or the call failed). */
export const getAgeAccess = cache(async (): Promise<AgeAccess | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  return loadAgeAccess(supabase);
});

/** The same for a client that is already the member's (the app's bearer client). */
export async function loadAgeAccess(supabase: SupabaseClient): Promise<AgeAccess | null> {
  const { data, error } = await supabase.rpc("my_age_access");
  if (error) {
    // Before 0159 is applied the function doesn't exist (PGRST202): carry on
    // as before, quietly — this runs on every page via the header.
    if (error.code !== "PGRST202") console.error("[age] my_age_access failed:", error.message);
    return null;
  }
  return parseAgeAccess(data);
}

// ---------------------------------------------------------------------------
// The parent's email
// ---------------------------------------------------------------------------

/**
 * "<First name> wants to join PinPals". The child's first name only — never
 * their surname or date of birth: this goes to an address a 14 year old
 * typed, and it might not be their parent's.
 */
export function parentEmailContent(input: { childFirstName: string; link: string }): { subject: string; text: string; html: string } {
  const name = input.childFirstName.trim() || "Your child";
  const subject = `${name} wants to join PinPals`;
  const intro = `${name} has asked to join PinPals, a golf app for golfers in Ireland and the UK — live scoring, scorecards, course maps and a marketplace for golf gear. Members under 16 need a parent or guardian to say yes first.`;
  const how = "To approve, you'll need your own PinPals account (for adults 18 and over). It's free, and it gives you a page where you can see their rounds, choose who they play with and stop approving at any time.";
  const expiry = "This link works for 30 days.";
  const ignore = "If you don't know about this, ignore this email — nothing happens unless you approve.";

  const text = [
    intro,
    "",
    "Once you approve, they can:",
    ...JUNIOR_CAN.map((l) => `  - ${l}`),
    "",
    "They can't:",
    ...JUNIOR_CANNOT.map((l) => `  - ${l}`),
    "",
    how,
    "",
    `Approve or decline: ${input.link}`,
    "",
    expiry,
    ignore,
  ].join("\n");

  const p = (s: string) => `<p style="margin:0 0 12px;color:#3a3a34;font-size:15px;line-height:1.5;">${escapeHtml(s)}</p>`;
  const list = (items: readonly string[]) =>
    `<ul style="margin:0 0 14px;padding-left:20px;color:#3a3a34;font-size:14px;line-height:1.5;">${items.map((i) => `<li>${escapeHtml(i)}</li>`).join("")}</ul>`;

  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#faf7f0;font-family:-apple-system,Segoe UI,Roboto,sans-serif;">
    <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:16px;padding:28px;border:1px solid #e6e0d4;">
      <div style="font-weight:800;font-size:20px;color:#0c2038;margin:0 0 18px;">Pin<span style="color:#c9a227;">pals</span></div>
      <h1 style="margin:0 0 16px;color:#14261e;font-size:20px;">${escapeHtml(subject)}</h1>
      ${p(intro)}
      <p style="margin:0 0 6px;color:#14261e;font-size:14px;font-weight:700;">Once you approve, they can:</p>
      ${list(JUNIOR_CAN)}
      <p style="margin:0 0 6px;color:#14261e;font-size:14px;font-weight:700;">They can't:</p>
      ${list(JUNIOR_CANNOT)}
      ${p(how)}
      <a href="${escapeHtml(input.link)}" style="display:inline-block;margin:6px 0 14px;padding:12px 22px;background:#1f5c2e;color:#faf7f0;text-decoration:none;border-radius:999px;font-weight:700;font-size:15px;">Approve or decline</a>
      <p style="margin:0 0 6px;color:#8a8478;font-size:13px;">${escapeHtml(expiry)}</p>
      <p style="margin:0;color:#8a8478;font-size:13px;">${escapeHtml(ignore)}</p>
    </div>
  </body>
</html>`;

  return { subject, text, html };
}

export async function sendParentEmail(input: { to: string; childFirstName: string; token: string }): Promise<void> {
  const link = `${getSiteUrl()}/parent#${input.token}`;
  const content = parentEmailContent({ childFirstName: input.childFirstName, link });
  const result = await sendEmail({ to: input.to, ...content });
  if (!result.sent) console.error("[age] parent email not sent:", result.reason);
}

// ---------------------------------------------------------------------------
// A junior's new or changed parent email
// ---------------------------------------------------------------------------

export type ReissueResult = { ok: true } | { ok: false; error: string };

/**
 * For a signed-in 13–15 year old with no approved parent: check the email,
 * revoke the pending link and make a new one (`guardian_link_reissue`,
 * service role only — it is what creates a secret, so the member can't call
 * it), then send the email. The caller has proved who the member is and has
 * rate-limited them.
 */
export async function reissueParentLink(memberClient: SupabaseClient, user: { id: string; email?: string | null }, rawEmail: unknown): Promise<ReissueResult> {
  const access = await loadAgeAccess(memberClient);
  if (!access || access.band !== "junior_pending") {
    return { ok: false, error: access?.band === "junior" ? "Your parent has already approved your account." : "Only members under 16 need a parent to approve their account." };
  }
  const checked = checkParentEmail(rawEmail, user.email);
  if (!checked.ok) return checked;

  const { token, hash } = newParentToken();
  const admin = createAdminClient();
  const { error } = await admin.rpc("guardian_link_reissue", { p_junior: user.id, p_email: checked.email, p_token_hash: hash });
  if (error) {
    console.error("[age] guardian_link_reissue failed:", error.message);
    return { ok: false, error: error.code === "22023" ? error.message : "Couldn't send that just now — please try again." };
  }

  const { data: me } = await admin.from("profiles").select("first_name").eq("id", user.id).maybeSingle<{ first_name: string | null }>();
  await sendParentEmail({ to: checked.email, childFirstName: me?.first_name ?? "", token });
  return { ok: true };
}
