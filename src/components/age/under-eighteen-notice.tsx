import Link from "next/link";
import type { AgeBlock } from "@/lib/junior";

/**
 * The friendly "not for you yet" panel, in place of a feature a member's age
 * keeps them from (0159). One component so every page says it the same way.
 * The database refuses these actions whatever the page shows; this is so a
 * member meets an explanation rather than a form that fails.
 */
export default function UnderEighteenNotice({
  feature,
  block = "under_18",
  compact = false,
}: {
  /** What they tried to open, in a few words: "Tee times", "Selling in the marketplace". */
  feature: string;
  block?: Exclude<AgeBlock, "waiting_for_parent">;
  compact?: boolean;
}) {
  const age = block === "under_16" ? 16 : 18;
  const body =
    block === "under_16"
      ? "Members under 16 play with the PinPals their parent approves, so finding and adding golfers is switched off for now."
      : "Some parts of PinPals are for adults only. They switch on by themselves on your 18th birthday.";

  if (compact) {
    return (
      <div className="bg-cream-100 rounded-2xl p-5">
        <p className="font-bold text-ink-900">{feature} isn&rsquo;t available to members under {age}.</p>
        <p className="text-sm text-ink-500 mt-1">{body}</p>
      </div>
    );
  }

  return (
    <div className="max-w-xl mx-auto px-6 py-16">
      <div className="bg-surface rounded-2xl shadow-lg p-8 text-center">
        <h1 className="font-display font-bold text-2xl mb-2">{feature} isn&rsquo;t available to members under {age}</h1>
        <p className="text-ink-500">{body}</p>
        <p className="text-ink-500 mt-3">Live scoring, your scorecards and the course maps are all yours in the app.</p>
        <Link href="/dashboard" className="inline-block mt-6 px-6 py-3 rounded-full font-bold bg-green-700 text-cream-50 hover:bg-green-600 transition">
          Back to your dashboard
        </Link>
      </div>
    </div>
  );
}
