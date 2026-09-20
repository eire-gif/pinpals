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
 * TWO TRANSPORTS, ONE TABLE. 0079 added `platform` to push_subscriptions so
 * that a browser subscription and a native device live in the same rows, with
 * one fan-out loop and one pruning path. The two differ completely below this
 * line and not at all above it:
 *
 *   web    — the payload is sealed per-subscription under RFC 8291 (ECDH
 *            against the device's p256dh, HKDF, AES-128-GCM) and signed with
 *            a VAPID JWT. Hand-rolling that fails as silent non-delivery,
 *            which is the worst failure mode this feature has, so `web-push`
 *            is the one SDK dependency in a codebase that otherwise talks to
 *            everything over plain fetch().
 *   native — a plain JSON POST to Expo's push service, which forwards to
 *            APNs. No key agreement, no encryption, no SDK.
 *
 * So VAPID being unset switches off web push and leaves native working. The
 * two used to be the same switch, which would have meant a missing browser
 * key silently disabling the iPhone notifications the app exists for.
 */

type PushSubscriptionRow = {
  id: number;
  endpoint: string;
  /** Null on native rows — see 0079. */
  p256dh: string | null;
  auth: string | null;
  failure_count: number;
  platform: "web" | "ios" | "android";
};

export type PushDispatchResult = {
  sent: number;
  pruned: number;
  /** True when push could not be attempted at the deployment level — no VAPID
   * keys and nothing native to fall back on. Distinct from "the member has no
   * devices", which is `sent: 0`. */
  disabled: boolean;
};

const NO_DEVICES: PushDispatchResult = { sent: 0, pruned: 0, disabled: false };

const EXPO_PUSH_ENDPOINT = "https://exp.host/--/api/v2/push/send";

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
      "[push] NEXT_PUBLIC_VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT are not all set — web push is disabled."
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

type Outcome = { dead: number[]; succeeded: number[]; failed: PushSubscriptionRow[] };

const EMPTY_OUTCOME = (): Outcome => ({ dead: [], succeeded: [], failed: [] });

// ---------------------------------------------------------------------------
// Web
// ---------------------------------------------------------------------------

async function sendWeb(rows: PushSubscriptionRow[], encoded: string): Promise<Outcome> {
  const outcome = EMPTY_OUTCOME();

  // A member has a handful of devices at most, so plain parallelism is
  // right — no concurrency limiter needed at this level. The limiter that
  // matters is the one around the RECIPIENT loop in
  // notifyConnectionsOfInvite(), which already exists.
  await Promise.all(
    rows.map(async (subscription) => {
      // Guarded by a CHECK in 0079, so this is belt and braces — but an
      // unsealed send would throw deep inside web-push rather than here.
      if (!subscription.p256dh || !subscription.auth) {
        outcome.dead.push(subscription.id);
        return;
      }

      try {
        await webpush.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: { p256dh: subscription.p256dh, auth: subscription.auth },
          },
          encoded
        );
        outcome.succeeded.push(subscription.id);
      } catch (sendError) {
        const status = statusCodeOf(sendError);
        if (isDeadSubscriptionStatus(status) || subscription.failure_count + 1 >= MAX_PUSH_FAILURES) {
          outcome.dead.push(subscription.id);
        } else {
          outcome.failed.push(subscription);
        }
      }
    })
  );

  return outcome;
}

// ---------------------------------------------------------------------------
// Native
// ---------------------------------------------------------------------------

type ExpoTicket =
  | { status: "ok"; id?: string }
  | { status: "error"; message?: string; details?: { error?: string } };

/**
 * One POST for every native device the member has. Expo takes up to 100
 * messages per request and answers with one ticket per message, in order.
 *
 * `DeviceNotRegistered` is native's 410: the app was uninstalled, or the
 * token was reissued. Delete on sight, exactly as web push does — this is the
 * only cleanup signal either transport gives.
 *
 * Expo also issues *receipts*, fetched minutes later, which report failures
 * APNs only discovers after accepting the message. Those are not read here:
 * it needs a second scheduled pass, and the immediate ticket already catches
 * the case that actually accumulates rows — an uninstalled app. The
 * failure_count ceiling catches the rest eventually.
 */
async function sendNative(rows: PushSubscriptionRow[], payload: PushPayload): Promise<Outcome> {
  const outcome = EMPTY_OUTCOME();

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  // Only needed once "Enhanced security for push notifications" is switched
  // on in the Expo dashboard. Sending it when it isn't required is harmless.
  const accessToken = process.env.EXPO_ACCESS_TOKEN;
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  const messages = rows.map((row) => ({
    to: row.endpoint,
    title: payload.title,
    body: payload.body,
    sound: "default" as const,
    // `href` is what hrefFromNotification() in the app reads to route a tap;
    // `tag` and `type` ride along so the two channels carry the same shape.
    data: { href: payload.href, tag: payload.tag, type: payload.type },
  }));

  let tickets: ExpoTicket[];

  try {
    const response = await fetch(EXPO_PUSH_ENDPOINT, {
      method: "POST",
      headers,
      body: JSON.stringify(messages),
    });

    if (!response.ok) {
      // A 4xx/5xx from Expo itself is transient as far as any one device is
      // concerned — do not prune anybody over it.
      console.error(`[push] Expo push service returned ${response.status}`);
      outcome.failed.push(...rows);
      return outcome;
    }

    const body = (await response.json()) as { data?: ExpoTicket[]; errors?: unknown };
    if (!Array.isArray(body.data)) {
      console.error("[push] Unexpected response from Expo push service:", body.errors ?? body);
      outcome.failed.push(...rows);
      return outcome;
    }
    tickets = body.data;
  } catch (error) {
    console.error("[push] Couldn't reach the Expo push service:", error instanceof Error ? error.message : error);
    outcome.failed.push(...rows);
    return outcome;
  }

  rows.forEach((row, index) => {
    const ticket = tickets[index];

    if (!ticket) {
      outcome.failed.push(row);
      return;
    }
    if (ticket.status === "ok") {
      outcome.succeeded.push(row.id);
      return;
    }

    const reason = ticket.details?.error;
    if (reason === "DeviceNotRegistered" || row.failure_count + 1 >= MAX_PUSH_FAILURES) {
      outcome.dead.push(row.id);
    } else {
      // InvalidCredentials, MessageTooBig, MessageRateExceeded — none of
      // which mean this particular device is gone.
      console.warn(`[push] Expo refused a message (${reason ?? ticket.message ?? "unknown"})`);
      outcome.failed.push(row);
    }
  });

  return outcome;
}

// ---------------------------------------------------------------------------

/**
 * Sends one payload to every device a member has registered, web and native.
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
  if (isPushPayloadTooLarge(payload)) {
    // Refusing here beats letting every device reject it individually.
    console.error(`[push] Payload for '${payload.type}' exceeds the size limit — not sent.`);
    return NO_DEVICES;
  }

  const { data: subscriptions, error } = await admin
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth, failure_count, platform")
    .eq("user_id", userId)
    .returns<PushSubscriptionRow[]>();

  if (error) {
    console.error(`[push] Couldn't load subscriptions for ${userId}:`, error.message);
    return NO_DEVICES;
  }
  if (!subscriptions || subscriptions.length === 0) return NO_DEVICES;

  const webRows = subscriptions.filter((row) => row.platform === "web");
  const nativeRows = subscriptions.filter((row) => row.platform !== "web");

  const webUsable = webRows.length > 0 && configureVapid();

  const [webOutcome, nativeOutcome] = await Promise.all([
    webUsable ? sendWeb(webRows, JSON.stringify(payload)) : Promise.resolve(EMPTY_OUTCOME()),
    nativeRows.length > 0 ? sendNative(nativeRows, payload) : Promise.resolve(EMPTY_OUTCOME()),
  ]);

  const deadIds = [...webOutcome.dead, ...nativeOutcome.dead];
  const succeededIds = [...webOutcome.succeeded, ...nativeOutcome.succeeded];
  const failed = [...webOutcome.failed, ...nativeOutcome.failed];

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

  return {
    sent: succeededIds.length,
    pruned: deadIds.length,
    // Only "switched off" if nothing could even be attempted.
    disabled: webRows.length > 0 && !webUsable && nativeRows.length === 0,
  };
}
