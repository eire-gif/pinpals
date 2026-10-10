import { formatPrice } from "@/lib/format";
import { buyerProtectionFee } from "@/lib/marketplace";
import { shortClub } from "@/lib/marketplace-growth";
import { CARD_TITLE, SOFT_CARD } from "@/components/marketplace/buy-styles";

/**
 * Mock-up 3's two cards, on the website: how the item reaches the buyer
 * (meet at the club with a handover code, or tracked post), and what Buyer
 * Protection does. Shop stock collects at the shop and carries no fee.
 */
export default function HowYoullGetIt({
  deliveryOptions,
  collectionNotes,
  meetAt,
  isShop,
  priceEur,
  showProtection,
}: {
  deliveryOptions: string[];
  collectionNotes: string | null;
  meetAt: string | null;
  isShop: boolean;
  priceEur: number | null;
  showProtection: boolean;
}) {
  const meet = deliveryOptions.includes("collection");
  const post = deliveryOptions.includes("post");
  return (
    <div className="grid gap-4 mt-6">
      <div className={SOFT_CARD}>
        <h2 className={CARD_TITLE}>How you&rsquo;ll get it</h2>
        <div className="grid gap-3 mt-3">
          {meet ? (
            <Way
              icon="⛳"
              title={isShop ? "Collect from the pro shop" : "Meet at the club"}
              body={
                meetAt
                  ? `${shortClub(meetAt)} — ${isShop ? "pick it up at the counter" : "hand over in person and show your code"}`
                  : "Hand over in person and show your code"
              }
              tag="Free"
            />
          ) : null}
          {post ? <Way icon="📦" title="Tracked post" body="Posted with tracking — you confirm when it arrives." /> : null}
        </div>
        {collectionNotes ? <p className="text-sm text-ink-500 mt-3">{collectionNotes}</p> : null}
      </div>

      {showProtection && !isShop ? (
        <div className="rounded-2xl bg-green-100 p-5">
          <h2 className={CARD_TITLE}>
            🛡️ Buyer Protection{priceEur !== null ? ` · ${formatPrice(buyerProtectionFee(priceEur))}` : ""}
          </h2>
          <ul className="mt-2 grid gap-1.5 text-sm text-ink-900">
            <li>✓ Your money is held until you have the item</li>
            <li>✓ Meet-ups confirmed with a handover code</li>
            <li>✓ Refund if it isn&rsquo;t as described</li>
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function Way({ icon, title, body, tag }: { icon: string; title: string; body: string; tag?: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-10 h-10 rounded-full bg-[#f3ead2] flex items-center justify-center shrink-0" aria-hidden>
        {icon}
      </span>
      <div className="flex-1">
        <p className="font-bold text-ink-900">{title}</p>
        <p className="text-sm text-ink-500">{body}</p>
      </div>
      {tag ? <span className="text-xs font-bold text-green-700">{tag}</span> : null}
    </div>
  );
}
