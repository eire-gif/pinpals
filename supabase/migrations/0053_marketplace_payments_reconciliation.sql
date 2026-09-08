-- Marketplace payments: close the two remaining gaps in the approved Stripe
-- payment flow (checkpoint "marketplace-payments") on top of the payment
-- persistence 0021 already shipped:
--
--   1. A successful payment never actually marked the listing sold. Every
--      real write to `listings.status` has always been active -> reserved
--      (offer_action()/create_purchase_order()) or reserved -> active
--      (release_expired_offer_reservations() on an expired checkout
--      window) — nothing anywhere has ever written 'sold', even though
--      it's a valid state (0011) and a valid transition (active -> sold,
--      reserved -> sold, 0045's validate_listing_status_transition()).
--      0048's own header comment flagged this explicitly at the time:
--      "apply_order_payment_succeeded() (0021) only flips status to
--      'completed'... touching that already-shipped webhook function is
--      out of scope here." This migration is that follow-up.
--
--      apply_order_payment_succeeded() is extended, in place, to also flip
--      the order's listing to 'sold' — in the SAME function body as the
--      order/ledger update, so "payment succeeded" and "listing sold" can
--      never disagree (the task's "update payment, order and listing state
--      in a database transaction" requirement, literally: one function
--      call is one Postgres transaction). Guarded to only fire when the
--      order UPDATE just above it actually matched a row (`found`) — a
--      duplicate/out-of-order redelivery of an already-'paid' order is a
--      no-op on the order (existing guard), and now stays a no-op on the
--      listing too, rather than re-running an update that would silently
--      no-op anyway (`where status in ('active','reserved')` — a listing
--      already 'sold', or one a moderator has since 'removed', is left
--      alone either way, but `found` avoids even attempting it).
--
--      Deliberately NOT symmetric: apply_order_payment_failed() does not
--      release the listing back to 'active'. createOrderPaymentIntent()
--      (src/app/dashboard/orders/[id]/actions.ts) lets a buyer retry the
--      SAME order with a fresh confirmation after a failed attempt, right
--      up until its reservation_expires_at — releasing the listing on the
--      first failed attempt would pull it out from under a buyer mid-retry.
--      release_expired_offer_reservations() (0048) already owns "the buyer
--      never completed checkout in time", purely on the timer, independent
--      of how many failed attempts happened along the way — see that
--      function's own header comment on the payment/expiry race it's
--      already built to resolve. Nothing here changes that split.
--
--   2. payment_intent.canceled was never handled — only .succeeded and
--      .payment_failed were. A PaymentIntent moves to 'canceled' when it's
--      explicitly canceled (abandoned checkout, or Stripe's own
--      automatic-cancellation for an incomplete PaymentIntent) rather than
--      declined; Stripe never redelivers a fresh .payment_failed for that
--      case. This is a TypeScript-only change (src/lib/stripe/payments.ts
--      gets a new handlePaymentIntentCanceled(), reusing the existing
--      apply_order_payment_failed() — there is no separate 'canceled' value
--      in orders.payment_status (0019), and a canceled PaymentIntent needs
--      exactly the same order-side outcome a failed one does: the buyer
--      must retry) — no schema change, noted here for the record since it
--      ships in the same checkpoint.
--
-- Rollback:
--   create or replace function public.apply_order_payment_succeeded(bigint, bigint, text, text)
--     ... -- restore 0021's version (no listing update)
--   -- (payment_intent.canceled handling is TS-only; revert that file directly)

create or replace function public.apply_order_payment_succeeded(
  p_event_row_id bigint,
  p_order_id bigint,
  p_payment_intent_id text,
  p_currency text
)
returns setof public.orders
language plpgsql
as $$
declare
  v_order public.orders%rowtype;
begin
  update public.webhook_events
    set status = 'processed',
        processed_at = now(),
        related_order_id = p_order_id
    where id = p_event_row_id;

  update public.orders
    set payment_status = 'paid',
        status = case when status = 'pending' then 'completed' else status end,
        payment_reference = p_payment_intent_id,
        currency = p_currency,
        payment_last_error = null,
        completed_at = coalesce(completed_at, now())
    where id = p_order_id
      and payment_status <> 'paid'
    returning * into v_order;

  if found then
    -- active -> sold covers a Buy Now purchase that (in theory) never
    -- passed through 'reserved'; reserved -> sold is the normal case for
    -- both offer-accept and Buy Now checkout (both reserve the listing at
    -- order-creation time, 0048/0050). Never touches a listing already
    -- 'sold' or one a moderator has since 'removed'.
    update public.listings
      set status = 'sold'
      where id = v_order.listing_id
        and status in ('active', 'reserved');

    return next v_order;
  end if;

  return;
end;
$$;

revoke execute on function public.apply_order_payment_succeeded(bigint, bigint, text, text) from public, anon, authenticated;
