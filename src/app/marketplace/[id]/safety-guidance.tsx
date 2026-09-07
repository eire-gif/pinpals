import ReportListingForm from "./report-listing-form";

const SAFETY_TIPS = [
  "Meet in a public place, or a club car park, to hand over golf equipment.",
  "Always pay and get paid through Pinpals checkout — never send money directly to a seller.",
  "Check the club/shaft/grip condition against the photos before you agree to buy.",
  "If a price seems too good to be true, or a seller pushes you to pay outside the app, treat it as a warning sign.",
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
      <ul className="grid gap-1.5 text-xs text-ink-700 mb-3">
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
