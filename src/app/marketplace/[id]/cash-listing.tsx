import Link from "next/link";

import { formatPrice, initials } from "@/lib/format";
import { shortClub } from "@/lib/marketplace-growth";
import { FEEDBACK_TAG_LABELS, positiveShare, type FeedbackEntry, type MemberRecord } from "@/lib/marketplace-cash";
import { CARD_TITLE, SOFT_CARD } from "@/components/marketplace/buy-styles";
import MessageSellerButton from "./message-seller-button";

/**
 * The listing page while the marketplace takes no payments (0160): Adverts
 * style. Three pieces, used by page.tsx in place of the checkout ones:
 *
 *   CashHowItWorks — message, meet at the club, pay cash or Revolut.
 *   CashPanel      — the price and the one thing to do: Message the seller,
 *                    or, for the seller, Mark as sold.
 *   CashFeedback   — the seller's marketplace feedback and a few comments.
 */

export function CashHowItWorks({
  sellerFirstName,
  meetAt,
  canPost,
  collectionNotes,
}: {
  sellerFirstName: string;
  meetAt: string | null;
  canPost: boolean;
  collectionNotes: string | null;
}) {
  // Folded until clicked, so the item itself comes first.
  return (
    <details className={`${SOFT_CARD} mt-6 group`}>
      <summary className="flex items-center gap-3 cursor-pointer list-none [&::-webkit-details-marker]:hidden">
        <h2 className={CARD_TITLE}>How it works</h2>
        <span className="ml-auto text-sm text-ink-500 group-open:hidden">Message · meet · pay</span>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="text-navy-900 transition group-open:rotate-180 group-open:ml-auto">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </summary>
      <ol className="grid gap-3 mt-3">
        <Step n={1} title={`Ask or offer ${sellerFirstName}`} body="In the open under Questions & offers, or privately in Messages." />
        <Step
          n={2}
          title={meetAt ? `Meet at ${shortClub(meetAt)}` : "Meet up"}
          body={canPost ? "Or agree postage between you. Try it on the green first if you can." : "Have a look at it, or try it on the green, before you pay."}
        />
        <Step n={3} title="Pay cash or Revolut" body="You agree it between you. Then swap feedback on PinPals." />
      </ol>
      {collectionNotes ? <p className="text-sm text-ink-500 mt-3">{collectionNotes}</p> : null}
      <p className="text-xs text-ink-500 mt-4 pt-3 border-t border-cream-100">
        PinPals doesn&rsquo;t handle payment. Check the item before you pay, and never pay a deposit to someone you haven&rsquo;t met.
      </p>
    </details>
  );
}

function Step({ n, title, body }: { n: number; title: string; body: string }) {
  return (
    <li className="flex gap-3">
      <span className="w-7 h-7 shrink-0 rounded-full bg-cream-100 text-navy-900 font-bold text-sm flex items-center justify-center" aria-hidden>
        {n}
      </span>
      <span>
        <span className="block font-bold text-[15px]">{title}</span>
        <span className="block text-sm text-ink-500">{body}</span>
      </span>
    </li>
  );
}

export function CashPanel({
  listingId,
  priceEur,
  openToOffers,
  status,
  sellerId,
  sellerFirstName,
  isSeller,
  signedIn,
  browseOnly,
  editHref,
  hasThread = false,
  highestOfferCents = null,
}: {
  listingId: number;
  priceEur: number | null;
  openToOffers: boolean;
  status: string;
  sellerId: string;
  sellerFirstName: string;
  isSeller: boolean;
  signedIn: boolean;
  browseOnly: boolean;
  editHref: string;
  /** The public questions & offers thread is on the page (0162). */
  hasThread?: boolean;
  highestOfferCents?: number | null;
}) {
  const onSale = status === "active" || status === "reserved";
  return (
    <div className="bg-surface rounded-2xl p-5 shadow-[0_3px_14px_rgba(12,32,56,0.08)] grid gap-4">
      <div className="flex items-center justify-between gap-3">
        <span className="text-3xl font-extrabold text-navy-900">{priceEur !== null ? formatPrice(priceEur) : "—"}</span>
        {openToOffers ? (
          <span className="bg-navy-900 text-gold-400 text-xs font-bold px-3 py-1.5 rounded-full">Open to offers</span>
        ) : null}
      </div>
      {hasThread ? (
        <a href="#questions" className="text-sm text-ink-500 hover:text-green-700 -mt-2">
          {highestOfferCents != null ? (
            <>
              Highest offer <span className="font-bold text-navy-900">€{Math.round(highestOfferCents / 100)}</span> · see questions &amp; offers
            </>
          ) : (
            "Questions & offers are public — see them below"
          )}
        </a>
      ) : null}

      {isSeller ? (
        <div className="grid gap-2">
          {onSale ? (
            <Link
              href={`/marketplace/${listingId}/sold`}
              className="w-full py-3 rounded-full font-bold text-center bg-navy-900 text-gold-400 hover:brightness-110 transition"
            >
              Mark as sold
            </Link>
          ) : null}
          <Link
            href={editHref}
            className="w-full py-2.5 rounded-full font-bold text-sm text-center border-[1.5px] border-navy-900 text-navy-900 hover:bg-cream-100 transition"
          >
            Edit details and photos
          </Link>
          <p className="text-xs text-ink-500 text-center">Mark it sold and pick who bought it — you can both leave feedback.</p>
        </div>
      ) : !onSale ? (
        <p className="text-sm text-ink-500">This item isn&rsquo;t for sale any more.</p>
      ) : browseOnly ? (
        <p className="text-sm text-ink-500">Buying isn&rsquo;t available to members under 18 — use Ask a parent in the app.</p>
      ) : signedIn ? (
        <div className="grid gap-2">
          {hasThread ? (
            <a
              href="#offer"
              className="w-full py-3 rounded-full font-bold text-center border-2 border-gold-500 text-navy-900 hover:bg-cream-50 transition"
            >
              Make an offer
            </a>
          ) : null}
          <MessageSellerButton sellerId={sellerId} listingId={listingId} label={`Message ${sellerFirstName}`} />
        </div>
      ) : (
        <Link
          href={`/login?next=/marketplace/${listingId}`}
          className="w-full py-3 rounded-full font-bold text-center bg-navy-900 text-gold-400 hover:brightness-110 transition"
        >
          Sign in to message {sellerFirstName}
        </Link>
      )}
    </div>
  );
}

export function CashFeedback({
  sellerId,
  sellerName,
  record,
  entries,
}: {
  sellerId: string;
  sellerName: string;
  record: MemberRecord;
  entries: FeedbackEntry[];
}) {
  const share = positiveShare(record);
  return (
    <section>
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <h2 className="font-display font-bold text-xl">Feedback for {sellerName.split(" ")[0]}</h2>
        <Link href={`/marketplace/sellers/${sellerId}`} className="text-sm font-bold text-green-700">
          See all
        </Link>
      </div>
      <p className="text-sm text-ink-500 mb-4">
        {share ? `${share} · ` : "No feedback yet · "}
        {record.sales} {record.sales === 1 ? "sale" : "sales"} on PinPals
      </p>
      {entries.length > 0 ? (
        <ul className="grid gap-3">
          {entries.map((entry) => (
            <FeedbackItem key={entry.id} entry={entry} />
          ))}
        </ul>
      ) : null}
    </section>
  );
}

export function FeedbackItem({ entry }: { entry: FeedbackEntry }) {
  return (
    <li className="bg-surface rounded-2xl p-4 shadow-[0_2px_10px_rgba(12,32,56,0.06)]">
      <div className="flex items-center gap-2 text-sm">
        <span
          className="w-7 h-7 rounded-full flex items-center justify-center text-white text-[11px] font-bold shrink-0"
          style={{ background: entry.reviewerAvatarColor ?? "#1f5c2e" }}
          aria-hidden
        >
          {initials(entry.reviewerName)}
        </span>
        <span className={`font-bold ${entry.positive ? "text-green-700" : "text-red-600"}`}>
          {entry.positive ? "👍 Good" : "👎 Not good"} · {entry.reviewerName}
        </span>
        <span className="ml-auto text-ink-500 text-xs">
          {new Intl.DateTimeFormat("en-IE", { day: "numeric", month: "short", year: "numeric" }).format(new Date(entry.createdAt))}
        </span>
      </div>
      {entry.body ? <p className="mt-2 text-[15px]">{entry.body}</p> : null}
      {entry.tags.length > 0 ? (
        <p className="mt-1 text-xs font-semibold text-navy-900">{entry.tags.map((t) => FEEDBACK_TAG_LABELS[t]).join(" · ")}</p>
      ) : null}
      <p className="mt-1 text-xs text-ink-500">
        {entry.role === "seller" ? "Bought" : "Sold them"}: {entry.itemTitle}
      </p>
    </li>
  );
}
