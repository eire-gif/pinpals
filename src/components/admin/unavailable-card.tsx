// Extracted from src/app/admin/page.tsx (Phase 4) so the user detail page
// can show the same honest "this subsystem doesn't exist yet" treatment for
// orders/reports as the overview page does for its own unbuilt metrics —
// same visual language, one definition. Behavior is unchanged from the
// original inline version.
export default function UnavailableCard({ label, reason }: { label: string; reason: string }) {
  return (
    <div className="bg-surface border border-dashed border-line rounded-2xl p-6">
      <div className="text-xs uppercase tracking-wide text-ink-500 font-semibold">{label}</div>
      <div className="font-display font-bold text-lg mt-1 text-ink-500">Data unavailable</div>
      <div className="text-xs text-ink-500 mt-1">{reason}</div>
    </div>
  );
}
