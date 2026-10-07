import Link from "next/link";

/**
 * Where a live scoring link lands on the website (an email, a shared link).
 * Scoring is an app feature: with the app installed the same link opens it
 * directly (universal links); on the web we say so plainly rather than show
 * a page that isn't there.
 */
export default function OpenInApp({ what }: { what: string }) {
  return (
    <div className="max-w-xl mx-auto px-6 py-20 text-center">
      <div className="bg-surface rounded-2xl shadow-lg p-10">
        <span className="inline-flex items-center gap-2 text-xs font-bold tracking-widest uppercase text-gold-600">
          <span className="w-5 h-0.5 bg-gold-500 inline-block" /> Live scoring
        </span>
        <h1 className="font-display font-bold text-3xl mt-3">Open {what} in the PinPals app</h1>
        <p className="text-ink-500 mt-3">
          Scores, the leaderboard and your scorecard live in the app, so everyone in your group sees each score as it goes in.
        </p>
        <Link
          href="/dashboard"
          className="inline-block mt-7 px-6 py-3 rounded-full font-bold bg-green-700 text-cream-50 hover:bg-green-600 transition"
        >
          Go to your dashboard
        </Link>
      </div>
    </div>
  );
}
