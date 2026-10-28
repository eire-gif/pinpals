"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requestAccountDeletion } from "@/lib/account-deletion";
import { hasPassword, signedInRecently } from "@/lib/auth/social-providers";

export type DeleteAccountState = { error?: string };

/**
 * Delete this member's account, after proving it is them.
 *
 * Apple allows a confirmation step and allows re-authentication; it does not
 * allow the process to be made unnecessarily difficult. A password and a
 * typed word is the usual bar for an irreversible action and stops a borrowed
 * phone or an unattended laptop from doing this.
 */
export async function deleteAccount(
  _prev: DeleteAccountState,
  formData: FormData
): Promise<DeleteAccountState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const password = String(formData.get("password") || "");
  const confirm = String(formData.get("confirm") || "").trim();

  if (confirm !== "DELETE") {
    return { error: "Type DELETE in the box to confirm." };
  }

  // Joined with Apple or Google (Oct 2026): there's no password to ask for,
  // so the proof is a fresh sign-in with that account instead.
  if (!hasPassword(user)) {
    if (!signedInRecently(user)) {
      return {
        error:
          "For your security, log out and sign in again with Apple or Google, then come straight back here to delete your account.",
      };
    }
  } else if (!password) {
    return { error: "Enter your password to confirm it's you." };
  }
  if (hasPassword(user)) {
    if (!user.email) {
      return { error: "This account has no email address — please contact support." };
    }

    // Re-authentication. A valid session says somebody has this browser; it
    // does not say they know the password, and this is not an action to take on
    // the word of a cookie.
    const { error: authError } = await supabase.auth.signInWithPassword({
      email: user.email,
      password,
    });

    if (authError) {
      return { error: "That password doesn't match." };
    }
  }

  const result = await requestAccountDeletion(supabase, user.id);

  if (!result.ok) {
    return { error: result.message };
  }

  revalidatePath("/profile");
  // The session has just been revoked, so there is nowhere signed-in left to
  // send them. The confirmation page is public for that reason.
  redirect(`/profile/delete/done?on=${encodeURIComponent(result.value.scheduledFor)}`);
}
