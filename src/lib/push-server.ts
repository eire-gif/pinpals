import "server-only";
import webpush from "web-push";
import type { SupabaseClient } from "@supabase/supabase-js";
import { MAX_PUSH_FAILURES, isDeadSubscriptionStatus, isPushPayloadTooLarge, type PushPayload } from "./push";

/**
 * The push half of the delivery layer, sitting beside src/lib/email.ts and
 * following its discipline exactly: gated on configuration, warns once when
 * it isn't configured, returns rather than throws on every failure. A
 * notification failing to deliver must never fail the purchase, message or
 * tee-time post it was describing.
 *
 * ONE NEW DEPENDENCY, DELIBERATELY. Everywhere else this app talks to an
 * external service over plain `fetch()` with no SDK (sendEmail() to Resend,
 * src/lib/stripe/balance.ts). Web push cannot reasonably follow that rule:
 * a payload must be sealed per-subscription under RFC 8291 — ECDH against
 * the device's p256dh key, HKDF derivation, AES-128-GCM — and signed with a
 * per-push-service VAPID JWT. Hand-rolling that fails as silent
 * non-delivery rather than as an error, which is the worst possible failure
 * mode for this feature. `web-push` is the reference implementation.
 *
 * (The dependency-free alternative, for the record: send a payload-less
 * push — VAPID auth only, no encryption — and have the service worker fetch
 * the content back from the server. It costs a round trip, needs a new
 * authenticated endpoint, and cannot render at all while offline.)
 */

type PushSubscriptionRow = {
  id: number;
  endpoint: string;
  p256dh: string;
  auth: string;
  failure_count: number;
};

export type PushDispatchResult = {
  sent: number;
  pruned: number;
  /** True when push is switched off at the deployment level (no VAPID keys)
   * — distinct from "the member has no devices", which is `sent: 0`. */
  disabled: boolean;
};

const NO_DEVICES: PushDispatchResult = { sent: 0, pruned: 0, disabled: false };

// Resolved once per process. `null` = not yet attempted, matching
// sendEmail()'s "warn once, then stay quiet" behaviour rather than logging
// the same missing-key line on every notification in a 200-member fan-out.
let vapidReady: boolean | null = null;

function configureVapid(): boolean {
  if (vapidReady !== null) return vapidReady;

  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;

  if (!publicKey || !privateKey || !subject) {
    console.warn(
      "[push] NEXT_PUBLIC_VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT are not all set — push notifications are disabled."
    );
    vapidReady = false;
    return false;
  }

  try {
    webpush.setVapidDetails(subject, publicKey, privateKey);
    vapidReady = true;
  } catch (error) {
    // A malformed key pair is a deployment error, not a runtime one — say
    // so loudly once and then behave exactly as if push were switched off.
    console.error("[push] VAPID configuration rejected:", error instanceof Error ? error.message : error);
    vapidReady = false;
  }

  return vapidReady;
}

/** Reads a push service's HTTP status off whatever `web-push` threw.
 * WebPushError carries `statusCode`; anything else is treated as transient. */
function statusCodeOf(error: unknown): number | null {
  if (typeof error === "object" && error !== null && "statusCode" in error) {
    const status = (error as { statusCode?: unknown }).statusCode;
    if (typeof status === "number") return status;
  }
  return null;
}

/**
 * Sends one payload to every device a member has registered.
 *
 * Pruning is the part that matters for long-term health. Web push has no
 * unsubscribe callback: the ONLY signal that a device is gone is a 404 or
 * 410 from the push service on a later send. Those rows are deleted on
 * sight. Everything else increments `failure_count`, and a subscription
 * that has failed MAX_PUSH_FAILURES times in a row is deleted too —
 * otherwise one permanently broken endpoint is retried on every single
 * notification for the life of the account.
 *
 * Requires a service-role client: the sender writes delivery health
 * (`last_success_at`, `failure_count`) and deletes dead rows, and
 * push_subscriptions deliberately has no authenticated UPDATE policy.
 */
export async function sendPushToUser(
  admin: SupabaseClient,
  userId: string,
  payload: PushPayload
): Promise<PushDispatchResult> {
  if (!configureVapid()) return { sent: 0, pruned: 0, disabled: true };

  if (isPushPayloadTooLarge(payload)) {
    // Refusing here beats letting every device reject it individually.
    console.error(`[push] Payload for '${payload.type}' exceeds the size limit — not sent.`);
    return NO_DEVICES;
  }

  const { data: subscriptions, error } = await admin
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth, failure_count")
    .eq("user_id", userId)
    .returns<PushSubscriptionRow[]>();

  if (error) {
    console.error(`[push] Couldn't load subscriptions for ${userId}:`, error.message);
    return NO_DEVICES;
  }
  if (!subscriptions || subscriptions.length === 0) return NO_DEVICES;

  const encoded = JSON.stringify(payload);
  const deadIds: number[] = [];
  const succeededIds: number[] = [];
  const failed: PushSubscriptionRow[] = [];

  // A member has a handful of devices at most, so plain parallelism is
  // right — no concurrency limiter needed at this level. The limiter that
  // matters is the one around the RECIPIENT loop in
  // notifyConnectionsOfInvite(), which already exists.
  await Promise.all(
    subscriptions.map(async (subscription) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: { p256dh: subscription.p256dh, auth: subscription.auth },
          },
          encoded
        );
        succeededIds.push(subscription.id);
      } catch (sendError) {
        const status = statusCodeOf(sendError);
        if (isDeadSubscriptionStatus(status) || subscription.failure_count + 1 >= MAX_PUSH_FAILURES) {
          deadIds.push(subscription.id);
        } else {
          failed.push(subscription);
        }
      }
    })
  );

  if (deadIds.length > 0) {
    const { error: deleteError } = await admin.from("push_subscriptions").delete().in("id", deadIds);
    if (deleteError) console.error("[push] Couldn't prune dead subscriptions:", deleteError.message);
  }

  if (succeededIds.length > 0) {
    const { error: updateError } = await admin
      .from("push_subscriptions")
      .update({ last_success_at: new Date().toISOString(), failure_count: 0 })
      .in("id", succeededIds);
    if (updateError) console.error("[push] Couldn't record push success:", updateError.message);
  }

  // Sequential, but `failed` is empty in the overwhelming majority of runs.
  for (const subscription of failed) {
    await admin
      .from("push_subscriptions")
      .update({ failure_count: subscription.failure_count + 1 })
      .eq("id", subscription.id);
  }

  return { sent: succeededIds.length, pruned: deadIds.length, disabled: false };
}
