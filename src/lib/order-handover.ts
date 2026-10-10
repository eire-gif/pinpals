import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

import { ORDER_REPORT_CATEGORIES, type ReportCategory } from "@/lib/admin/reports";
import { formatPrice } from "@/lib/format";
import { releaseOrder } from "@/lib/marketplace-release";
import { notifyUser } from "@/lib/notifications-server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Order } from "@/lib/types";

/**
 * The steps between paying and being paid (0114), shared by the website's
 * order page and the app's /api/app/orders/[id]/handover route.
 *
 * Each step runs as the member (their own Supabase client), so the
 * database's order_* functions decide who may do what. Only the release
 * itself — a Stripe transfer — uses the service role, and only after the
 * database has agreed the order is due.
 */

export type HandoverStep =
  | { kind: "meetup"; at: string; place: string }
  | { kind: "code"; code: string }
  | { kind: "posted"; tracking: string | null }
  | { kind: "received" }
  | { kind: "problem"; category: string | null; description: string | null };

export type HandoverResult = { ok: true; released?: boolean } | { ok: false; message: string };

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-IE", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Dublin" });

/** The database's own words are written for members; anything else is generic. */
function friendly(message: string | undefined): string {
  if (!message) return "That didn't work. Please try again.";
  if (/permission denied|violates|syntax|function/i.test(message)) return "That didn't work. Please try again.";
  return message;
}

export async function runHandoverStep(supabase: SupabaseClient, userId: string, orderId: number, step: HandoverStep): Promise<HandoverResult> {
  const admin = createAdminClient();
  const load = async () => (await admin.from("orders").select("*").eq("id", orderId).maybeSingle<Order>()).data;

  switch (step.kind) {
    case "meetup": {
      const { error } = await supabase.rpc("order_set_meetup", { p_order_id: orderId, p_at: step.at, p_place: step.place });
      if (error) return { ok: false, message: friendly(error.message) };
      const order = await load();
      if (order) {
        const other = userId === order.buyer_id ? order.seller_id : order.buyer_id;
        await notifyUser(admin, {
          userId: other,
          type: "seller_action_required",
          title: "Meet-up arranged",
          body: `"${order.listing_title}": ${when(step.at)} at ${step.place}.`,
          href: `/dashboard/orders/${orderId}`,
          data: { orderId },
          dedupeKey: `order:${orderId}:meetup:${step.at}:${other}`,
        });
      }
      return { ok: true };
    }

    case "code": {
      const { data, error } = await supabase.rpc("order_confirm_handover", { p_order_id: orderId, p_code: step.code.trim() });
      if (error) return { ok: false, message: friendly(error.message) };
      if (data === "wrong") return { ok: false, message: "That code isn't right. Check it with the buyer." };
      if (data === "locked") return { ok: false, message: "Too many wrong codes. Contact PinPals support to finish this sale." };
      const order = await load();
      if (!order) return { ok: true };
      await notifyUser(admin, {
        userId: order.buyer_id,
        type: "payment_succeeded",
        title: "Handover complete",
        body: `Enjoy your "${order.listing_title}". ${formatPrice(Number(order.amount_eur))} has gone to the seller.`,
        href: `/dashboard/orders/${orderId}`,
        data: { orderId },
        dedupeKey: `order:${orderId}:handover:buyer`,
      });
      const outcome = await releaseOrder(admin, order);
      return { ok: true, released: outcome === "released" };
    }

    case "posted": {
      const { error } = await supabase.rpc("order_mark_posted", { p_order_id: orderId, p_tracking: step.tracking });
      if (error) return { ok: false, message: friendly(error.message) };
      const order = await load();
      if (order) {
        await notifyUser(admin, {
          userId: order.buyer_id,
          type: "seller_action_required",
          title: "Your item is on its way",
          body: `"${order.listing_title}" has been posted${order.tracking_ref ? ` (tracking ${order.tracking_ref})` : ""}. Tap "It arrived" when you have it.`,
          href: `/dashboard/orders/${orderId}`,
          data: { orderId },
          dedupeKey: `order:${orderId}:posted:buyer`,
        });
      }
      return { ok: true };
    }

    case "received": {
      const { error } = await supabase.rpc("order_confirm_received", { p_order_id: orderId });
      if (error) return { ok: false, message: friendly(error.message) };
      const order = await load();
      if (!order) return { ok: true };
      const outcome = await releaseOrder(admin, order);
      return { ok: true, released: outcome === "released" };
    }

    case "problem": {
      const { error } = await supabase.rpc("order_flag_problem", { p_order_id: orderId });
      // Already released: the report still goes to staff, as before 0114.
      const alreadyPaid = !!error && /already been paid/.test(error.message);
      if (error && !alreadyPaid) return { ok: false, message: friendly(error.message) };
      await admin.from("reports").insert({
        reporter_id: userId,
        target_type: "order",
        target_id: String(orderId),
        category: ORDER_REPORT_CATEGORIES.includes(step.category as ReportCategory) ? step.category : "item_not_as_described",
        description: step.description?.trim() || "Problem reported from the order page (Buyer Protection).",
        wants_refund: true,
      });
      const order = await load();
      if (order) {
        await notifyUser(admin, {
          userId: order.seller_id,
          type: "dispute_opened",
          title: "The buyer reported a problem",
          body: `PinPals is looking into "${order.listing_title}". Payment is on hold until it's sorted.`,
          href: `/dashboard/orders/${orderId}`,
          data: { orderId },
          dedupeKey: `order:${orderId}:problem:seller`,
        });
      }
      return alreadyPaid ? { ok: false, message: error!.message } : { ok: true };
    }
  }
}
