import Image from "next/image";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { CARD_TITLE, GOLD_BUTTON, NAVY_OUTLINE_BUTTON, SOFT_CARD } from "@/components/marketplace/buy-styles";
import { formatPrice } from "@/lib/format";
import { PROMOTIONS, isFeatured, isTopPick, type PromotionKind } from "@/lib/marketplace-growth";
import { brandLabel } from "@/lib/marketplace-brands";
import { TOP_PICKS } from "@/lib/finder";
import { createClient } from "@/lib/supabase/server";
import { startPromotionAction } from "./actions";

const ERRORS: Record<string, string> = {
  busy: "Too many attempts — please try again in a little while.",
  not_active: "Only a listing that's live on the marketplace can be promoted.",
  stripe: "Couldn't open the payment page just now. Please try again.",
};

/**
 * Get your advert into Top picks (0163, approved mock-up "Flow · Website:
 * Boost your ad"): Premium or Premium Plus, paid with Stripe Checkout. Website only — the app points here in words, never a link,
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

  // "*" rather than a column list, so the page still opens against a
  // database without 0163's columns yet.
  const { data: listing } = await supabase
    .from("listings")
    .select("*")
    .eq("id", listingId)
    .maybeSingle<{
      id: number;
      seller_id: string;
      title: string;
      image_url: string | null;
      price_eur: number | null;
      status: string;
      store_id: number | null;
      category: string;
      brand: string | null;
      model_id?: string | null;
      featured_until: string | null;
      top_pick_until?: string | null;
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
  const inTopPicks = isTopPick(listing);
  const until = listing.top_pick_until ?? listing.featured_until;
  let modelFamily = "";
  if (listing.model_id) {
    const { data: m } = await supabase.from("marketplace_models").select("family").eq("id", listing.model_id).maybeSingle<{ family: string }>();
    modelFamily = m?.family ?? "";
  }
  const brandName = listing.brand && !["other", "unknown", "mixed"].includes(listing.brand) ? brandLabel(listing.brand) : "";
  const shows = [
    listing.category,
    brandName ? `${listing.category} › ${brandName}` : "",
    brandName && modelFamily ? `${listing.category} › ${brandName} › ${modelFamily}` : "",
    "The marketplace home",
  ].filter(Boolean);
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
        <span className="w-5 h-0.5 bg-gold-500 inline-block" /> {TOP_PICKS.title}
      </span>
      <h1 className="font-display font-bold text-3xl mt-2">Get your advert seen first</h1>

      <div className={`${SOFT_CARD} mt-6 flex items-center gap-4`}>
        <div className="relative w-20 h-20 shrink-0 rounded-xl overflow-hidden bg-surface-tint">
          {listing.image_url ? <Image src={listing.image_url} alt="" fill className="object-cover" /> : null}
        </div>
        <div className="min-w-0">
          <p className="font-bold text-ink-900 truncate">{listing.title}</p>
          <p className="text-navy-900 font-extrabold text-lg">{listing.price_eur !== null ? formatPrice(listing.price_eur) : "Auction"}</p>
          {inTopPicks || featured ? (
            <p className="text-sm text-gold-600 font-bold">
              {featured ? "Premium Plus" : "Premium"} · in {TOP_PICKS.title} until{" "}
              {new Date(until!).toLocaleDateString("en-IE", { day: "numeric", month: "short" })}
            </p>
          ) : null}
        </div>
      </div>

      {paid ? (
        <div className="mt-5 rounded-2xl bg-green-100 text-green-800 px-5 py-4 text-sm font-semibold">
          {justPaid?.status === "active"
            ? `Paid — your advert is in ${TOP_PICKS.title}.`
            : `Thanks — payment received. Your advert goes into ${TOP_PICKS.title} within a minute or two.`}
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
        <>
          <div className="grid sm:grid-cols-2 gap-5 mt-6">
            {(["bump", "featured"] as PromotionKind[]).map((kind) => {
              const offer = PROMOTIONS[kind];
              const highlight = kind === "featured";
              const extend = highlight ? featured : inTopPicks;
              return (
                <form
                  key={kind}
                  action={startPromotionAction}
                  className={`${SOFT_CARD} relative flex flex-col ${highlight ? "ring-2 ring-gold-400" : ""}`}
                >
                  <input type="hidden" name="listingId" value={listing.id} />
                  <input type="hidden" name="kind" value={kind} />
                  {highlight ? (
                    <span className="absolute -top-3 right-5 text-[11px] font-bold uppercase tracking-wider bg-gold-400 text-navy-900 rounded-full px-2.5 py-1">
                      Most views
                    </span>
                  ) : null}
                  <h2 className={CARD_TITLE}>{offer.title}</h2>
                  <p className="font-extrabold text-3xl text-navy-900 mt-3">{formatPrice(offer.eur)}</p>
                  <ul className="mt-3 flex-1 list-disc pl-5 text-sm text-ink-900 leading-7">
                    {offer.perks.map((perk) => (
                      <li key={perk}>{perk}</li>
                    ))}
                  </ul>
                  <button type="submit" className={`${highlight ? GOLD_BUTTON : NAVY_OUTLINE_BUTTON} mt-5 w-full`}>
                    {extend ? `Add ${offer.days} days` : `Go ${offer.title}`} · {formatPrice(offer.eur)}
                  </button>
                </form>
              );
            })}
          </div>

          <div className={`${SOFT_CARD} mt-5`}>
            <h2 className={CARD_TITLE}>Where it shows</h2>
            <p className="text-sm text-ink-500 mt-1">At the top for anyone browsing any of these:</p>
            <div className="flex flex-wrap gap-2 mt-3">
              {shows.map((s) => (
                <span key={s} className="px-3.5 py-1.5 rounded-full bg-navy-900 text-cream-50 text-sm font-bold">
                  {s}
                </span>
              ))}
            </div>
            <p className="text-sm text-ink-500 mt-4">
              Every advert in {TOP_PICKS.title} carries a gold {TOP_PICKS.badge} badge, so buyers know it&rsquo;s paid for. Up to{" "}
              {TOP_PICKS.slots} show at once; when more are paid for the same search, they take turns. Mark it sold and it comes out
              straight away.
              {!modelFamily && listing.category !== "Shoes & apparel" ? " Pick the exact model on your listing so it shows for that model too." : ""}
            </p>
          </div>
        </>
      )}
      <p className="text-xs text-ink-500 mt-4">
        Paid securely by Stripe. Top picks placements are a service from PinPals and aren&rsquo;t refundable once live, unless the
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
