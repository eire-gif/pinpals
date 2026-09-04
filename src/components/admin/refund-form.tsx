"use client";

import { useActionState, useState } from "react";
import type { RefundActionState } from "@/app/admin/orders/[id]/actions";

const initialState: RefundActionState = {};

/**
 * The finance-admin refund control on /admin/orders/[id]. Deliberately not
 * built on ModerationForm/SimpleActionForm (src/components/admin/) — those
 * are single-field (reason-only) confirms, and this needs an amount field
 * plus a genuinely separate review step before submission, per the task's
 * "require a reason and explicit confirmation" requirement: the first
 * screen is an editable amount + reason, the second is a plain-language
 * summary ("Refund €X to the buyer?") with its own "Confirm refund" button
 * — going "Back" resets nothing already typed. `refundableEur` is computed
 * server-side (src/lib/stripe/refunds.ts's computeRefundableAmountEur(),
 * called from the page) and shown as both a cap on the input and the
 * confirmation copy — this component never invents that figure itself.
 */
export default function RefundForm({
  orderId,
  refundableEur,
  action,
}: {
  orderId: number;
  refundableEur: number;
  action: (state: RefundActionState, formData: FormData) => Promise<RefundActionState>;
}) {
  const [state, formAction, pending] = useActionState(action, initialState);
  const [amount, setAmount] = useState(refundableEur.toFixed(2));
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState(false);

  if (state.success) {
    return (
      <p className="text-xs text-green-700 bg-green-100 rounded-lg px-3 py-2">
        Refund requested — refreshing…
      </p>
    );
  }

  const parsedAmount = Number(amount);
  const amountValid = Number.isFinite(parsedAmount) && parsedAmount > 0 && parsedAmount <= refundableEur;
  const reasonValid = reason.trim().length > 0;

  if (!confirming) {
    return (
      <div className="flex flex-col gap-2">
        <label className="text-xs text-ink-500 flex flex-col gap-1">
          Refund amount (up to €{refundableEur.toFixed(2)})
          <input
            type="number"
            min="0.01"
            max={refundableEur}
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-full text-sm rounded-lg border-[1.5px] border-line px-3 py-2 bg-surface text-ink-900"
          />
        </label>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          required
          rows={2}
          placeholder="Reason (recorded in the audit log)"
          className="w-full text-sm rounded-lg border-[1.5px] border-line px-3 py-2 resize-none bg-surface"
        />
        {amount !== "" && !amountValid && (
          <p className="text-xs text-red-600 bg-red-100 rounded-lg px-3 py-2">
            Enter an amount between €0.01 and €{refundableEur.toFixed(2)}.
          </p>
        )}
        <button
          type="button"
          disabled={!amountValid || !reasonValid}
          onClick={() => setConfirming(true)}
          className="self-start px-4 py-2 rounded-full font-bold text-sm transition disabled:opacity-60 bg-navy-900 text-cream-50 hover:bg-navy-800"
        >
          Review refund
        </button>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="amountEur" value={amount} />
      <input type="hidden" name="reason" value={reason} />
      <div className="text-sm bg-surface-tint border border-line rounded-lg p-3">
        <p className="text-ink-900">
          Refund <span className="font-bold">€{parsedAmount.toFixed(2)}</span> to the buyer?
        </p>
        <p className="text-ink-500 mt-1 whitespace-pre-wrap">{reason}</p>
      </div>
      {state.error && <p className="text-xs text-red-600 bg-red-100 rounded-lg px-3 py-2">{state.error}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setConfirming(false)}
          disabled={pending}
          className="px-4 py-2 rounded-full font-bold text-sm transition disabled:opacity-60 bg-cream-100 text-ink-900 hover:bg-cream-200"
        >
          Back
        </button>
        <button
          type="submit"
          disabled={pending}
          className="px-4 py-2 rounded-full font-bold text-sm transition disabled:opacity-60 bg-red-600 text-cream-50 hover:bg-red-500"
        >
          {pending ? "Processing…" : "Confirm refund"}
        </button>
      </div>
    </form>
  );
}
