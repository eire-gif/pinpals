"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/admin/authorization";
import { FINANCE_ROLES } from "@/lib/admin/finance";
import { recordAdminAction } from "@/lib/admin/audit";
import { retryWebhookEvent } from "@/lib/stripe/payments";

type RetryActionState = { error?: string; success?: boolean };

/**
 * An admin's manual "Retry" click on a failed /admin/webhook-events row —
 * the one admin *interaction* this phase's payment persistence work audits
 * (see the comment on "webhook_event.retried" in src/lib/admin/audit.ts).
 * Re-runs the exact same routing logic the live webhook route uses
 * (src/lib/stripe/payments.ts's processStripeEvent(), via retryWebhookEvent())
 * against this event's own already-stored, already-signature-verified
 * payload — never a fresh call out to Stripe for a payload with a name that
 * could be spoofed.
 *
 * Deliberately logs only the event type and outcome in the audit metadata —
 * never the stored payload itself, per the task's "do not log sensitive
 * Stripe payload content" requirement, same discipline as
 * refreshSellerAccountStatus() in src/app/admin/payouts/[id]/actions.ts.
 */
export async function retryFailedWebhookEvent(
  _prev: RetryActionState,
  formData: FormData
): Promise<RetryActionState> {
  const { user, staff } = await requireStaff({ roles: FINANCE_ROLES });
  const eventRowId = Number(formData.get("eventRowId"));
  if (!eventRowId || Number.isNaN(eventRowId)) return { error: "Missing event id." };

  let outcome: string;
  try {
    outcome = await retryWebhookEvent(eventRowId);
  } catch {
    await recordAdminAction({
      actor: { id: user.id, role: staff.role },
      action: "webhook_event.retried",
      targetType: "webhook_event",
      targetId: eventRowId,
      outcome: "failure",
    });
    return { error: "Couldn't retry that event just now — please try again in a moment." };
  }

  await recordAdminAction({
    actor: { id: user.id, role: staff.role },
    action: "webhook_event.retried",
    targetType: "webhook_event",
    targetId: eventRowId,
    outcome: "success",
    metadata: { outcome },
  });

  revalidatePath(`/admin/webhook-events/${eventRowId}`);
  revalidatePath("/admin/webhook-events");
  return { success: true };
}
