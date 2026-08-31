import Image from "next/image";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import type { Listing } from "@/lib/types";
import { COUNTIES } from "@/lib/clubs";
import { CATEGORIES } from "@/lib/marketplace";
import ListingCard from "./listing-card";

export default async function MarketplacePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; category?: string; county?: string; sort?: string; listed?: string }>;
}) {
  const { q = "", category = "", county = "", sort = "recent", listed } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let query = supabase.from("listings").select("*").eq("status", "active");

  if (q) {
    query = query.or(`title.ilike.%${q}%,description.ilike.%${q}%`);
  }
  if (category) {
    query = query.eq("category", category);
  }
  if (county) {
    query = query.eq("county", county);
  }
  if (sort === "price_low") {
    query = query.order("price_eur", { ascending: true });
  } else if (sort === "price_high") {
    query = query.order("price_eur", { ascending: false });
  } else {
    query = query.order("created_at", { ascending: false });
  }

  const { data: listings } = await query.limit(60).returns<Listing[]>();

  return (
    <div>
      <div className="relative bg-navy-900 text-white pt-16 pb-14 overflow-hidden">
        <Image
          src="/images/marketplace-header.jpg"
          alt="Golf clubs laid out on grass"
          fill
          className="object-cover -z-10 opacity-40"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-[rgba(9,22,40,0.55)] to-[rgba(9,22,40,0.92)] -z-10" />
        <div className="max-w-6xl mx-auto px-6">
          <span className="inline-flex items-center gap-2 text-xs font-bold tracking-widest uppercase text-gold-500">
            <span className="w-5 h-0.5 bg-gold-500 inline-block" /> Marketplace
          </span>
          <h1 className="font-display font-bold text-4xl mt-2.5">Buy and sell golf gear.</h1>
          <p className="text-white/80 mt-3 max-w-[52ch]">
            Clear out the garage or find your next set — clubs, bags and gear, golfer to golfer.
          </p>
          <Link
            href={user ? "/marketplace/new" : "/signup"}
            className="inline-block mt-6 px-6 py-3 rounded-full font-bold bg-green-700 text-cream-50 hover:bg-green-600 transition"
          >
            {user ? "List an item" : "Join to start selling"}
          </Link>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-14">
        {listed && (
          <div className="mb-6 bg-green-100 text-green-800 rounded-xl px-4 py-3 text-sm font-semibold">
            Listing published — it&rsquo;s live on the marketplace now.
          </div>
        )}
        <form className="flex flex-wrap gap-3.5 items-center justify-between bg-surface border border-line rounded-2xl px-5 py-4 shadow-sm mb-8">
          <div className="relative flex-1 min-w-[220px]">
            <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input type="text" name="q" defaultValue={q} placeholder="Search clubs, bags, gear…"
              className="w-full pl-10 pr-3.5 py-2.5 rounded-full border-[1.5px] border-line bg-surface-tint text-sm" />
          </div>
          <select name="category" defaultValue={category} className="px-3.5 py-2.5 rounded-full border-[1.5px] border-line bg-surface-tint text-sm font-semibold">
            <option value="">All categories</option>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select name="county" defaultValue={county} className="px-3.5 py-2.5 rounded-full border-[1.5px] border-line bg-surface-tint text-sm font-semibold">
            <option value="">All counties</option>
            {COUNTIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select name="sort" defaultValue={sort} className="px-3.5 py-2.5 rounded-full border-[1.5px] border-line bg-surface-tint text-sm font-semibold">
            <option value="recent">Newest first</option>
            <option value="price_low">Price: low to high</option>
            <option value="price_high">Price: high to low</option>
          </select>
          <button type="submit" className="px-5 py-2.5 rounded-full font-bold bg-green-700 text-cream-50 text-sm">
            Search
          </button>
        </form>

        {!listings || listings.length === 0 ? (
          <div className="text-center py-16 text-ink-500">
            No listings match that search yet — widen your filters, or be the first to list something.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {listings.map((listing) => (
              <ListingCard key={listing.id} listing={listing} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
