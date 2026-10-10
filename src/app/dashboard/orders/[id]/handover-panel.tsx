"use client";

import { useActionState, useState } from "react";

import type { Order } from "@/lib/types";
import { handoverAction, type OrderActionState } from "./actions";

/**
 * Buyer Protection on the order page (0114) — the website twin of the app's
 * order screen. Navy-and-gold cards, as in the marketplace design.
 *
 * Buyer: the handover code (collection) or "It arrived" (post), the meet-up,
 * and "Problem with this item" while the money is still held.
 * Seller: the meet-up, entering the buyer's code, or "Mark as posted".
 */

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-IE", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Dublin" });
const day = (iso: string) => new Date(iso).toLocaleDateString("en-IE", { weekday: "short", day: "numeric", month: "short", timeZone: "Europe/Dublin" });

export default function HandoverPanel({
  order,
  role,
  code,
  defaultPlace,
}: {
  order: Order;
  role: "buyer" | "seller";
  code: string | null;
  defaultPlace: string | null;
}) {
  const [state, action, pending] = useActionState<OrderActionState, FormData>(handoverAction.bind(null, order.id), {});
  const [reporting, setReporting] = useState(false);
  const f = order.fulfilment_status;
  if (!f) return null;
  const held = order.payout_status === "held";
  const collection = order.delivery_method !== "post";

  return (
    <div className="grid gap-4 mb-6">
      {/* The headline card */}
      <div className="rounded-2xl bg-navy-900 text-cream-50 border-[1.5px] border-gold-500 shadow-[0_3px_0_#9c7a2c] p-6 text-center">
        {f === "problem" ? (
          <>
            <Eyebrow>Payment on hold</Eyebrow>
            <p className="font-display font-bold text-2xl mt-2">Problem reported</p>
            <p className="text-sm opacity-85 mt-2">PinPals is looking into it. Nobody is paid until it&rsquo;s sorted.</p>
          </>
        ) : !held ? (
          <>
            <Eyebrow>Complete</Eyebrow>
            <p className="font-display font-bold text-2xl mt-2">{role === "seller" ? "You've been paid" : "All done — enjoy it"}</p>
            {order.released_at ? <p className="text-sm opacity-85 mt-2">Payment released {day(order.released_at)}.</p> : null}
          </>
        ) : role === "buyer" && collection ? (
          <>
            <Eyebrow>Your handover code</Eyebrow>
            <p className="font-extrabold text-6xl tracking-[0.35em] mt-2 pl-[0.35em]">{code ?? "····"}</p>
            <p className="text-sm opacity-85 mt-2">
              Check the item, then read this to the seller. They enter it and the money is released.
            </p>
          </>
        ) : role === "buyer" ? (
          <>
            <Eyebrow>{f === "posted" ? "On its way" : "Waiting to be posted"}</Eyebrow>
            <p className="font-display font-bold text-2xl mt-2">{f === "posted" ? "Has it arrived?" : "The seller is posting it"}</p>
            {order.tracking_ref ? <p className="text-sm opacity-85 mt-1">Tracking {order.tracking_ref}</p> : null}
            <form action={action} className="mt-4">
              <input type="hidden" name="step" value="received" />
              <GoldButton pending={pending}>It arrived — all OK</GoldButton>
            </form>
            {order.release_due_at ? (
              <p className="text-xs opacity-75 mt-3">If you don&rsquo;t report a problem, the seller is paid on {day(order.release_due_at)}.</p>
            ) : null}
          </>
        ) : collection ? (
          <>
            <Eyebrow>Get paid at the handover</Eyebrow>
            <p className="text-sm opacity-90 mt-2">Ask the buyer for their 4-digit code once they&rsquo;ve checked the item.</p>
            <form action={action} className="mt-4 flex gap-2 justify-center">
              <input type="hidden" name="step" value="code" />
              <input
                name="code"
                inputMode="numeric"
                pattern="[0-9]{4}"
                maxLength={4}
                placeholder="0000"
                required
                className="w-36 text-center text-3xl font-extrabold tracking-[0.3em] rounded-xl bg-cream-50 text-navy-900 py-2"
                aria-label="The buyer's handover code"
              />
              <GoldButton pending={pending}>Confirm</GoldButton>
            </form>
          </>
        ) : f === "awaiting_post" ? (
          <>
            <Eyebrow>Time to post it</Eyebrow>
            <form action={action} className="mt-4 grid gap-2 max-w-sm mx-auto">
              <input type="hidden" name="step" value="posted" />
              <input
                name="tracking"
                maxLength={80}
                placeholder="Tracking number (optional)"
                className="rounded-xl bg-cream-50 text-navy-900 px-4 py-3 text-center"
              />
              <GoldButton pending={pending}>Mark as posted</GoldButton>
            </form>
          </>
        ) : (
          <>
            <Eyebrow>Posted</Eyebrow>
            <p className="font-display font-bold text-2xl mt-2">Waiting for the buyer</p>
            {order.release_due_at ? <p className="text-sm opacity-85 mt-2">You&rsquo;re paid when it arrives, or on {day(order.release_due_at)} at the latest.</p> : null}
          </>
        )}
        {state.error ? <p className="mt-3 text-sm font-semibold text-gold-400">{state.error}</p> : null}
      </div>

      {/* The meet-up */}
      {collection && held && f === "awaiting_handover" ? (
        <div className="rounded-2xl bg-surface border border-line p-5">
          {order.meetup_at && order.meetup_place ? (
            <>
              <div className="font-bold text-lg">{when(order.meetup_at)}</div>
              <div className="text-sm text-ink-500">{order.meetup_place}</div>
              <div className="flex gap-2 flex-wrap mt-3">
                <a
                  className="px-4 py-2 rounded-full border border-line text-sm font-semibold"
                  href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(order.meetup_place)}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Directions
                </a>
              </div>
              <details className="mt-3">
                <summary className="text-sm font-semibold text-green-700 cursor-pointer">Change the time or place</summary>
                <MeetupForm action={action} pending={pending} place={order.meetup_place} />
              </details>
              {order.release_due_at ? (
                <p className="text-xs text-ink-500 mt-3">
                  If nobody reports a problem, the seller is paid automatically on {day(order.release_due_at)}.
                </p>
              ) : null}
            </>
          ) : (
            <>
              <div className="font-bold">Arrange the meet-up</div>
              <p className="text-sm text-ink-500">Meet at a golf club, in daylight.</p>
              <MeetupForm action={action} pending={pending} place={defaultPlace ?? ""} />
            </>
          )}
        </div>
      ) : null}

      {role === "buyer" && held && f !== "problem" ? (
        <div className="rounded-2xl bg-green-100 p-5 text-sm text-green-800">
          <div className="font-bold mb-1">Buyer Protection</div>
          <ul className="list-disc pl-5 grid gap-0.5">
            {collection ? <li>Don&rsquo;t share the code until you&rsquo;ve checked the item.</li> : <li>Only tap &ldquo;It arrived&rdquo; once you have it and it&rsquo;s as described.</li>}
            <li>Not as described? Report it below — the seller isn&rsquo;t paid while we look into it.</li>
          </ul>
          {reporting ? (
            <form action={action} className="mt-3 grid gap-2">
              <input type="hidden" name="step" value="problem" />
              <select name="category" className="rounded-lg border border-line px-3 py-2 bg-surface text-ink-900">
                <option value="item_not_as_described">Not as described</option>
                <option value="item_not_received">Never arrived / no-show</option>
                <option value="scam_fraud">Scam or fraud</option>
                <option value="other">Something else</option>
              </select>
              <textarea name="description" maxLength={4000} rows={3} placeholder="What's wrong?" className="rounded-lg border border-line px-3 py-2 bg-surface text-ink-900" />
              <button disabled={pending} className="py-2.5 rounded-full bg-red-600 text-white font-bold disabled:opacity-60">
                Report and hold the payment
              </button>
            </form>
          ) : (
            <button type="button" onClick={() => setReporting(true)} className="mt-3 font-bold text-red-600">
              Problem with this item
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}

function MeetupForm({ action, pending, place }: { action: (fd: FormData) => void; pending: boolean; place: string }) {
  return (
    <form action={action} className="grid gap-2 mt-3 sm:grid-cols-[1fr_1fr_auto]">
      <input type="hidden" name="step" value="meetup" />
      <input type="datetime-local" name="at" required className="rounded-lg border border-line px-3 py-2 bg-surface" aria-label="Meet-up time" />
      <input name="place" required maxLength={160} defaultValue={place} placeholder="e.g. Portmarnock GC car park" className="rounded-lg border border-line px-3 py-2 bg-surface" aria-label="Where to meet" />
      <button disabled={pending} className="px-5 py-2 rounded-full bg-navy-900 text-cream-50 font-bold disabled:opacity-60">
        Save
      </button>
    </form>
  );
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return <div className="text-[11px] font-bold tracking-[0.14em] uppercase text-gold-400">{children}</div>;
}

function GoldButton({ children, pending }: { children: React.ReactNode; pending: boolean }) {
  return (
    <button
      disabled={pending}
      className="px-6 py-3 rounded-full bg-gold-400 text-navy-900 font-bold shadow-[0_3px_0_#9c7a2c] active:translate-y-[2px] active:shadow-none disabled:opacity-60"
    >
      {pending ? "…" : children}
    </button>
  );
}
