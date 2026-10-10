import Image from "next/image";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { CARD_TITLE, GOLD_BUTTON, NAVY_OUTLINE_BUTTON, SOFT_CARD } from "@/components/marketplace/buy-styles";
import { formatPrice } from "@/lib/format";
import { PROMOTIONS, isFeatured, type PromotionKind } from "@/lib/marketplace-growth";
import { createClient } from "@/lib/supabase/server";
import { startPromotionAction } from "./actions";

const ERRORS: Record<string, string> = {
  busy: "Too many attempts — please try again in a little while.",
  not_active: "Only a listing that's live on the marketplace can be promoted.",
  stripe: "Couldn't open the payment page just now. Please try again.",
};

/**
 * Promote one of your listings (0115): Featured or Bump, paid with Stripe
 * Checkout. Website only — the app points here in words, never a link,
 * because a promotion is a digital service (App Store rule 3.1.1).
 */
export default async function PromoteListingPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ paid?: string; cancelled?: string; error?: string }>;
}) {
  const { id } = await params;
  const { paid, cancelled, error } = await searchParams;
  const listingId = Number(id);
  if (!Number.isInteger(listingId)) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: listing } = await supabase
    .from("listings")
    .select("id, seller_id, title, image_url, price_eur, status, store_id, featured_until, bumped_at")
    .eq("id", listingId)
    .maybeSingle<{
      id: number;
      seller_id: string;
      title: string;
      image_url: string | null;
      price_eur: number | null;
      status: string;
      store_id: number | null;
      featured_until: string | null;
      bumped_at: string | null;
    }>();
  if (!listing || listing.seller_id !== user.id) notFound();

  const { data: history } = await supabase
    .from("listing_promotions")
    .select("id, kind, amount_eur, status, starts_at, ends_at, created_at")
    .eq("listing_id", listingId)
    .order("created_at", { ascending: false })
    .limit(10)
    .returns<{ id: number; kind: PromotionKind; amount_eur: number; status: string; starts_at: string | null; ends_at: string | null; created_at: string }[]>();

  const featured = isFeatured(listing);
  const canPromote = listing.status === "active" && !listing.store_id;
  const justPaid = paid ? (history ?? []).find((p) => String(p.id) === paid) : undefined;
  // An abandoned checkout leaves a pending row behind; it isn't history.
  const past = (history ?? []).filter((p) => p.status !== "pending");

  return (
    <div className="max-w-3xl mx-auto px-6 py-12">
      <Link href="/dashboard/listings?tab=active" className="text-sm font-semibold text-ink-500 hover:text-ink-900">
        ← My listings
      </Link>
      <span className="mt-6 flex items-center gap-2 text-xs font-bold tracking-widest uppercase text-gold-600">
        <span className="w-5 h-0.5 bg-gold-500 inline-block" /> Sell it faster
      </span>
      <h1 className="font-display font-bold text-3xl mt-2">Promote your listing</h1>

      <div className={`${SOFT_CARD} mt-6 flex items-center gap-4`}>
        <div className="relative w-20 h-20 shrink-0 rounded-xl overflow-hidden bg-surface-tint">
          {listing.image_url ? <Image src={listing.image_url} alt="" fill className="object-cover" /> : null}
        </div>
        <div className="min-w-0">
          <p className="font-bold text-ink-900 truncate">{listing.title}</p>
          <p className="text-navy-900 font-extrabold text-lg">{listing.price_eur !== null ? formatPrice(listing.price_eur) : "Auction"}</p>
          {featured ? (
            <p className="text-sm text-gold-600 font-bold">
              ★ Featured until {new Date(listing.featured_until!).toLocaleDateString("en-IE", { day: "numeric", month: "short" })}
            </p>
          ) : null}
        </div>
      </div>

      {paid ? (
        <div className="mt-5 rounded-2xl bg-green-100 text-green-800 px-5 py-4 text-sm font-semibold">
          {justPaid?.status === "active"
            ? "Paid — your promotion is live."
            : "Thanks — payment received. Your promotion switches on within a minute or two."}
        </div>
      ) : null}
      {cancelled ? (
        <div className="mt-5 rounded-2xl bg-cream-100 px-5 py-4 text-sm text-ink-900">No payment was taken.</div>
      ) : null}
      {error && ERRORS[error] ? (
        <div className="mt-5 rounded-2xl bg-red-100 text-red-600 px-5 py-4 text-sm font-semibold">{ERRORS[error]}</div>
      ) : null}

      {!canPromote ? (
        <p className={`${SOFT_CARD} mt-6 text-ink-500`}>
          {listing.store_id ? "Pro shop stock is promoted by PinPals, not per item." : ERRORS.not_active}
        </p>
      ) : (
        <div className="grid sm:grid-cols-2 gap-5 mt-6">
          {(Object.keys(PROMOTIONS) as PromotionKind[]).map((kind) => {
            const offer = PROMOTIONS[kind];
            const highlight = kind === "featured";
            return (
              <form
                key={kind}
                action={startPromotionAction}
                className={`${SOFT_CARD} flex flex-col ${highlight ? "ring-2 ring-gold-400" : ""}`}
              >
                <input type="hidden" name="listingId" value={listing.id} />
                <input type="hidden" name="kind" value={kind} />
                <div className="flex items-center justify-between">
                  <h2 className={CARD_TITLE}>{offer.title}</h2>
                  {highlight ? (
                    <span className="text-[11px] font-bold uppercase tracking-wider bg-gold-400 text-navy-900 rounded-full px-2.5 py-1">
                      Most seen
                    </span>
                  ) : null}
                </div>
                <p className="font-extrabold text-3xl text-navy-900 mt-3">{formatPrice(offer.eur)}</p>
                <p className="text-sm text-ink-500 mt-1">{kind === "featured" ? "7 days" : "Instant"}</p>
                <p className="text-sm text-ink-900 mt-3 flex-1">{offer.blurb}</p>
                <button type="submit" className={`${highlight ? GOLD_BUTTON : NAVY_OUTLINE_BUTTON} mt-5 w-full`}>
                  {kind === "featured" ? (featured ? "Extend by 7 days" : "Feature it") : "Bump it"} · {formatPrice(offer.eur)}
                </button>
              </form>
            );
          })}
        </div>
      )}
      <p className="text-xs text-ink-500 mt-4">
        Paid securely by Stripe. Promotions are a service from PinPals and aren&rsquo;t refundable once live, unless the
        listing is removed by us.
      </p>

      {past.length > 0 ? (
        <div className="mt-10">
          <h2 className={CARD_TITLE}>History</h2>
          <ul className="mt-3 divide-y divide-line bg-surface rounded-2xl border border-line">
            {past.map((p) => (
              <li key={p.id} className="flex items-center justify-between px-5 py-3 text-sm">
                <span className="font-semibold">{PROMOTIONS[p.kind].title}</span>
                <span className="text-ink-500">
                  {new Date(p.starts_at ?? p.created_at).toLocaleDateString("en-IE", { day: "numeric", month: "short" })}
                </span>
                <span className="text-ink-500 capitalize">{p.status}</span>
                <span className="font-bold">{formatPrice(Number(p.amount_eur))}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
