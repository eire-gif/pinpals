import Link from "next/link";

/**
 * The compact header the two management tabs use.
 *
 * Deliberately not the browse page's hero. "Find a game this week" is a
 * recruiting line for someone scanning open invites; a member who has come
 * to answer three requests does not need to be sold the feature, they need
 * the requests above the fold.
 */
export default function TeeTimesPageHeader({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div className="bg-navy-900 text-white pt-14 pb-10">
      <div className="max-w-6xl mx-auto px-6">
        <span className="inline-flex items-center gap-2 text-xs font-bold tracking-widest uppercase text-gold-500">
          <span className="w-5 h-0.5 bg-gold-500 inline-block" /> {eyebrow}
        </span>
        <h1 className="font-display font-bold text-3xl mt-2.5">{title}</h1>
        <p className="text-white/80 mt-2.5 max-w-[56ch]">{description}</p>
        <Link
          href="/dashboard/availability/new"
          className="inline-block mt-5 px-5 py-2.5 rounded-full font-bold text-sm bg-green-700 text-cream-50 hover:bg-green-600 transition"
        >
          Post your availability
        </Link>
      </div>
    </div>
  );
}
