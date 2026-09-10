"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { resolveClientIp } from "@/lib/rate-limit";
import { LEGAL_DOCUMENTS } from "@/lib/legal";
import { documentSha256 } from "@/lib/legal/hash";
import type { ConsentSource } from "@/lib/consent";
import { normalisePhone, isPhoneRegion } from "@/lib/phone";

export type LegalCentreState = { error?: string; success?: string };

const MAX_USER_AGENT_LENGTH = 300;

/**
 * Every consent write from the dashboard goes through here, so that the
 * evidence fields are captured the same way in every case and nobody has
 * to remember to add them. Note there is no update path and no delete
 * path: withdrawing is a new row saying so (see migration 0074).
 */
async function recordConsent(
  userId: string,
  rows: {
    consent_type: string;
    granted: boolean;
    document_version?: string | null;
    content_sha256?: string | null;
  }[],
  source: ConsentSource
) {
  if (rows.length === 0) return null;

  const supabase = await createClient();
  const headerList = await headers();
  const ip = await resolveClientIp();

  const { error } = await supabase.from("member_consent_events").insert(
    rows.map((row) => ({
      user_id: userId,
      consent_type: row.consent_type,
      granted: row.granted,
      document_version: row.document_version ?? null,
      content_sha256: row.content_sha256 ?? null,
      source,
      ip_address: ip === "unknown" ? null : ip,
      user_agent: (headerList.get("user-agent") || "").slice(0, MAX_USER_AGENT_LENGTH) || null,
    }))
  );

  return error;
}

/**
 * Re-accepts every document whose current version or content hash differs
 * from what the member last accepted.
 *
 * Deliberately re-derives the out-of-date set on the server rather than
 * trusting the form to say which documents were shown: between rendering
 * the page and submitting it, a deploy could have changed a document, and
 * recording an acceptance of a version the member never saw is the exact
 * failure this whole system exists to prevent.
 */
export async function acceptCurrentDocuments(
  _prev: LegalCentreState,
  _formData: FormData
): Promise<LegalCentreState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/dashboard/legal");

  const { data: current } = await supabase
    .from("member_current_consents")
    .select("consent_type, granted, document_version, content_sha256")
    .eq("user_id", user.id)
    .returns<
      { consent_type: string; granted: boolean; document_version: string | null; content_sha256: string | null }[]
    >();

  const byType = new Map((current ?? []).map((row) => [row.consent_type, row]));

  const outstanding = LEGAL_DOCUMENTS.filter((doc) => {
    const accepted = byType.get(doc.consentType);
    if (!accepted || !accepted.granted) return true;
    return accepted.document_version !== doc.version || accepted.content_sha256 !== documentSha256(doc);
  }).map((doc) => ({
    consent_type: doc.consentType,
    granted: true,
    document_version: doc.version,
    content_sha256: documentSha256(doc),
  }));

  if (outstanding.length === 0) {
    return { success: "You're already up to date." };
  }

  const error = await recordConsent(user.id, outstanding, "re_acceptance");
  if (error) return { error: error.message };

  revalidatePath("/dashboard/legal");
  return { success: "Thanks — that's recorded." };
}

/**
 * Turns the weekly digest on or off.
 *
 * Article 7(3) requires withdrawal to be as easy as giving consent. Giving
 * it is one tick at sign-up; withdrawing it is one switch here. If this
 * ever grows a confirmation step, an "are you sure?" or a retention offer,
 * it stops meeting that standard.
 */
export async function updateMarketingConsent(
  _prev: LegalCentreState,
  formData: FormData
): Promise<LegalCentreState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/dashboard/legal");

  const granted = formData.get("marketingEmail") === "on";

  const error = await recordConsent(user.id, [{ consent_type: "marketing_email", granted }], "dashboard");
  if (error) return { error: error.message };

  revalidatePath("/dashboard/legal");
  return {
    success: granted
      ? "You're subscribed to the weekly digest."
      : "You've been unsubscribed from the weekly digest.",
  };
}

/**
 * Saves or clears the private phone number.
 *
 * Clearing it deletes the row rather than storing an empty string, for the
 * same reason 0059 deletes a birthdate row when the field is cleared: "I'd
 * rather you didn't hold my number" is a different request from "hold it
 * but don't use it", and clearing the field is the first one.
 */
export async function updatePhoneNumber(
  _prev: LegalCentreState,
  formData: FormData
): Promise<LegalCentreState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/dashboard/legal");

  const regionRaw = String(formData.get("phoneRegion") || "IE");
  const region = isPhoneRegion(regionRaw) ? regionRaw : "IE";
  const result = normalisePhone(String(formData.get("phone") || ""), region);
  if (!result.ok) return { error: result.error };

  if (result.e164 === null) {
    // Only the phone lives on this row today alongside the referral answer,
    // so clearing the number nulls the column rather than deleting the row
    // — deleting it would silently discard the referral answer too.
    const { error } = await supabase
      .from("member_private_details")
      .update({ phone_e164: null })
      .eq("user_id", user.id);
    if (error) return { error: error.message };

    revalidatePath("/dashboard/legal");
    return { success: "We've removed your phone number." };
  }

  const { error } = await supabase
    .from("member_private_details")
    .upsert({ user_id: user.id, phone_e164: result.e164 }, { onConflict: "user_id" });
  if (error) return { error: error.message };

  revalidatePath("/dashboard/legal");
  return { success: "Phone number saved." };
}
