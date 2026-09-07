import { initials, formatJoinedDate } from "@/lib/format";
import MessageSellerButton from "./message-seller-button";

/**
 * "seller card with rating, verification, joined date and Message button"
 * (this phase's spec). Every prop here is already public elsewhere in the
 * app — full name and home club/county are shown in the community
 * directory (src/app/community/page.tsx) to any member, rating is the same
 * publicly-readable `reviews` aggregation the seller-readiness page shows
 * about themselves — so nothing new is exposed by putting them together on
 * a listing page. What's deliberately NOT a prop here: email, the seller's
 * raw stripe_connected_accounts row (charges_enabled etc. collapse to the
 * one `verified` boolean before this component ever sees them), or
 * anything from the offer/order tables about a specific transaction.
 */
export default function SellerCard({
  sellerId,
  name,
  homeClub,
  county,
  avatarColor,
  joinedAtIso,
  verified,
  rating,
  viewerIsSignedIn,
  viewerIsSeller,
}: {
  sellerId: string;
  name: string;
  homeClub: string | null;
  county: string | null;
  avatarColor: string | null;
  joinedAtIso: string;
  verified: boolean;
  rating: { average: number; count: number } | null;
  viewerIsSignedIn: boolean;
  viewerIsSeller: boolean;
}) {
  const location = [homeClub, county].filter(Boolean).join(" · ");

  return (
    <div className="bg-surface border border-line rounded-2xl p-5">
      <div className="flex items-center gap-3">
        <div
          className="w-11 h-11 rounded-full flex items-center justify-center text-white font-display font-bold shrink-0"
          style={{ background: avatarColor ?? "#1f5c2e" }}
          aria-hidden="true"
        >
          {initials(name)}
        </div>
        <div className="min-w-0">
          <div className="font-bold truncate">{name}</div>
          {location && <div className="text-xs text-ink-500 truncate">{location}</div>}
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5 mt-3">
        {verified && (
          <span className="inline-flex items-center gap-1 bg-green-100 text-green-800 text-xs font-bold px-2.5 py-1 rounded-full">
            <CheckIcon /> Verified seller
          </span>
        )}
        <span className="bg-cream-100 text-ink-900 text-xs font-bold px-2.5 py-1 rounded-full">
          {rating ? `★ ${rating.average} (${rating.count} review${rating.count === 1 ? "" : "s"})` : "No reviews yet"}
        </span>
      </div>

      <p className="text-xs text-ink-500 mt-2">{formatJoinedDate(joinedAtIso)}</p>

      {viewerIsSignedIn && !viewerIsSeller && (
        <div className="mt-4">
          <MessageSellerButton sellerId={sellerId} />
        </div>
      )}
    </div>
  );
}

function CheckIcon() {
  return (
    <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
      <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
