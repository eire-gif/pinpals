import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { formatPrice, initials } from "@/lib/format";
import { possibleBuyers } from "@/lib/marketplace-cash";
import type { Listing } from "@/lib/types";
import { markSoldAction } from "../../cash-actions";

export const metadata: Metadata = { title: "Mark as sold | Pinpals Marketplace", robots: { index: false } };

/**
 * Mark as sold (cash marketplace, 0160; mock-up 6 on the website).
 *
 * "Who bought it?" from the people the seller has chatted with — this
 * listing's chats first — or "Sold somewhere else". Naming the buyer opens
 * feedback for both; mark_listing_sold() only accepts someone the seller has
 * actually messaged. The final price is optional and private.
 */
export default async function MarkSoldPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const listingId = Number.parseInt(id, 10);
  if (!Number.isInteger(listingId) || listingId <= 0) notFound();
  const error = (await searchParams).error;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/marketplace/${listingId}/sold`);

  const { data: listing } = await supabase
    .from("listings")
    .select("id, title, price_eur, status, seller_id, image_url")
    .eq("id", listingId)
    .maybeSingle<Pick<Listing, "id" | "title" | "price_eur" | "status" | "seller_id" | "image_url">>();
  if (!listing || listing.seller_id !== user.id) notFound();
  if (listing.status !== "active" && listing.status !== "reserved") redirect(`/marketplace/${listingId}`);

  const buyers = await possibleBuyers(supabase, listingId);

  return (
    <div className="max-w-xl mx-auto px-6 py-14">
      <Link href={`/marketplace/${listingId}`} className="text-sm text-green-700 font-bold">
        &larr; Back to the listing
      </Link>

      <div className="flex items-center gap-4 mt-6">
        {listing.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={listing.image_url} alt="" className="w-16 h-16 rounded-xl object-cover" />
        ) : (
          <div className="w-16 h-16 rounded-xl bg-cream-100" aria-hidden />
        )}
        <div>
          <p className="font-bold">{listing.title}</p>
          {listing.price_eur !== null ? <p className="text-sm text-ink-500">Listed at {formatPrice(listing.price_eur)}</p> : null}
        </div>
      </div>

      <h1 className="font-display font-bold text-3xl mt-8">Who bought it?</h1>
      <p className="text-ink-500 mt-1">Pick the buyer so you can both leave feedback.</p>

      <form action={markSoldAction} className="grid gap-5 mt-6">
        <input type="hidden" name="listing_id" value={listingId} />
        <fieldset className="grid gap-2">
          <legend className="sr-only">Buyer</legend>
          {buyers.map((b, index) => (
            <label
              key={b.id}
              className="flex items-center gap-3 bg-surface rounded-2xl p-3 border border-cream-100 has-[:checked]:border-green-700 has-[:checked]:border-2 cursor-pointer"
            >
              <input type="radio" name="buyer" value={b.id} defaultChecked={index === 0 && b.aboutListing} className="w-5 h-5 accent-green-700" />
              <span
                className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm shrink-0"
                style={{ background: b.avatarColor ?? "#1f5c2e" }}
                aria-hidden
              >
                {initials(b.name)}
              </span>
              <span>
                <span className="block font-semibold">{b.name}</span>
                <span className="block text-xs text-ink-500">{b.aboutListing ? "Messaged you about this" : "Chatted on PinPals"}</span>
              </span>
            </label>
          ))}
          <label className="flex items-center gap-3 bg-surface rounded-2xl p-3 border border-cream-100 has-[:checked]:border-green-700 has-[:checked]:border-2 cursor-pointer">
            <input type="radio" name="buyer" value="elsewhere" className="w-5 h-5 accent-green-700" />
            <span>
              <span className="block font-semibold">Sold somewhere else</span>
              <span className="block text-xs text-ink-500">No feedback either way</span>
            </span>
          </label>
          {buyers.length === 0 ? (
            <p className="text-sm text-ink-500">
              Nobody has messaged you on PinPals yet. If the buyer is on PinPals, ask them to send you a message first.
            </p>
          ) : null}
        </fieldset>

        <label className="grid gap-1.5">
          <span className="text-sm font-semibold">Final price (optional, private)</span>
          <input
            name="final_price"
            inputMode="decimal"
            defaultValue={listing.price_eur ?? ""}
            className="h-12 rounded-xl border border-cream-100 bg-surface px-4 text-base"
          />
          <span className="text-xs text-ink-500">Helps the price guide. Never shown with your name.</span>
        </label>

        {typeof error === "string" ? <p className="text-sm font-semibold text-red-600">{error}</p> : null}

        <button type="submit" className="py-3.5 rounded-full font-bold bg-navy-900 text-gold-400 hover:brightness-110 transition">
          Mark as sold
        </button>
      </form>
    </div>
  );
}
