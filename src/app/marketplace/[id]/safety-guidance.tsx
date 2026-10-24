import ReportListingForm from "./report-listing-form";

import { SAFETY_TIPS as CHAT_TIPS } from "@/lib/message-safety";

// Oct 2026 (0188): the cash marketplace — the old "pay through Pinpals
// checkout" tip contradicted how buying works now. The first three are the
// same tips shown in a marketplace chat.
const SAFETY_TIPS = [
  ...CHAT_TIPS,
  "Check the club, shaft and grip against the photos before you hand over any money.",
  "If a price seems too good to be true, or someone asks for a deposit, a courier or a gift card, walk away.",
];

/**
 * "safety guidance and report action" (this phase's spec) — static tips
 * plus ReportListingForm. Deliberately just prose, not a DB-backed content
 * table: this is the same kind of fixed policy copy as the seller-setup
 * page's Stripe disclaimer, not something staff need to edit without a
 * deploy.
 */
export default function SafetyGuidance({ listingId }: { listingId: number }) {
  return (
    <div className="bg-surface-tint border border-line rounded-xl p-4">
      <h3 className="text-xs font-bold uppercase tracking-wider text-ink-500 mb-2.5">Buying safely</h3>
      <ul className="grid gap-1.5 text-xs text-ink-900 mb-3">
        {SAFETY_TIPS.map((tip) => (
          <li key={tip} className="flex gap-2">
            <span className="text-green-700" aria-hidden="true">
              &middot;
            </span>
            <span>{tip}</span>
          </li>
        ))}
      </ul>
      <ReportListingForm listingId={listingId} />
    </div>
  );
}
