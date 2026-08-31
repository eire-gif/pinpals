import { formatPrice } from "@/lib/format";
import { computeOfferTotal } from "@/lib/marketplace";

export default function PriceSummary({ amountEur }: { amountEur: number }) {
  const { amount, fee, total } = computeOfferTotal(amountEur);

  return (
    <div className="bg-surface-tint border border-line rounded-xl p-4">
      <h4 className="text-xs font-bold uppercase tracking-wider text-ink-500 mb-3">
        Price summary
      </h4>
      <div className="grid gap-1.5 text-sm">
        <div className="flex justify-between">
          <span className="text-ink-500">Offer</span>
          <span>{formatPrice(amount)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-ink-500">Pinpals fee (7%)</span>
          <span>{formatPrice(fee)}</span>
        </div>
      </div>
      <div className="flex justify-between items-baseline mt-3 pt-3 border-t border-line">
        <span className="font-bold">Total to pay</span>
        <span className="font-display font-bold text-xl text-green-700">
          {formatPrice(total)}
        </span>
      </div>
    </div>
  );
}
