"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { expressInterest as expressInterestFor } from "@/lib/tee-times-operations";

export type InterestState = { error?: string; success?: boolean };

/**
 * Thin wrapper over the shared operation in src/lib/tee-times-operations.ts.
 *
 * Everything that decides anything — the invite checks, the insert, the
 * duplicate handling, and the notification to the host — lives there, because
 * the iOS app needs the identical sequence and two copies would eventually
 * disagree. What is left here is what only the website has: a session from
 * cookies, a useActionState shape, and Next's cache to invalidate.
 */
export async function expressInterest(
  inviteId: number,
  _prev: InterestState,
  _formData: FormData
): Promise<InterestState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const result = await expressInterestFor(supabase, user.id, inviteId);

  if (!result.ok) {
    // Deliberately no revalidation on the failure paths, matching the
    // behaviour before the extraction: nothing changed, so nothing is stale.
    return { error: result.message };
  }

  revalidatePath("/tee-times");
  revalidatePath("/tee-times/interested");
  revalidatePath("/tee-times/requests");
  revalidatePath("/dashboard");
  return { success: true };
}
