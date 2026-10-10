import Image from "next/image";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import {
  parseMarketplaceFilters,
  fetchMarketplaceListings,
  fetchBrandFacets,
  marketplaceFiltersToSearchParams,
  RESULTS_PAGE_SIZE,
  type MarketplaceFilters,
} from "@/lib/marketplace-discovery";
import { formatPrice } from "@/lib/format";
import {
  loadActiveStores,
  loadAffiliateDeals,
  loadListingsForCards,
  loadLiveBanner,
  shortClub,
  type Banner,
} from "@/lib/marketplace-growth";
import { GOLD_BUTTON } from "@/components/marketplace/buy-styles";
import MarketplaceControls from "./marketplace-controls";
import LoadMoreListings from "./load-more-listings";
import ListingCard from "./listing-card";

/**
 * The marketplace (Oct 2026 redesign, approved mock-ups 1 and 2 — the same
 * shape as the app).
 *
 * Used Gear | New Gear over a photograph.
 *
 * USED GEAR (default) — members' own clubs: quick chips, the paid Featured
 * row while nothing is searched, then the full, URL-driven search
 * (search_marketplace_listings, used gear only since 0116).
 *
 * NEW GEAR (?mode=new) — the sponsored banner, approved pro shops, their
 * stock, and retailer deals (0115). Retailer and banner links go through
 * /go/… so every click is counted before the golfer leaves.
 */
export default async function MarketplacePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const mode = raw.mode === "new" ? "new" : "used";
  const filters = parseMarketplaceFilters(raw);
  const listed = raw.listed;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const userId = user?.id ?? null;

  return (
    <div>
      <section className="relative overflow-hidden">
        <Image
          src={mode === "new" ? "/images/dunes.jpg" : "/images/marketplace-header.jpg"}
          alt=""
          fill
          priority
          sizes="100vw"
          className="object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-navy-900/55 via-navy-900/45 to-navy-900/80" />
        <div className="relative max-w-6xl mx-auto px-6 pt-10 pb-8">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <span className="inline-flex items-center gap-2 text-xs font-bold tracking-widest uppercase text-gold-400">
                <span className="w-5 h-0.5 bg-gold-400 inline-block" /> Marketplace
              </span>
              <h1 className="font-display font-bold text-3xl sm:text-4xl text-cream-50 mt-2">
                {mode === "new" ? "New gear, from the pro shop." : "Golf gear, from golfers."}
              </h1>
            </div>
            <Link href={user ? "/marketplace/new" : "/signup"} className={GOLD_BUTTON}>
              {user ? "Sell an item" : "Join to start selling"}
            </Link>
          </div>

          <div className="mt-6 inline-flex rounded-full bg-navy-900/70 p-1 backdrop-blur" role="tablist" aria-label="New or used gear">
            {(["used", "new"] as const).map((m) => (
              <Link
                key={m}
                href={m === "new" ? "/marketplace?mode=new" : "/marketplace"}
                role="tab"
                aria-selected={mode === m}
                className={`px-6 py-2 rounded-full text-sm font-extrabold transition ${
                  mode === m ? "bg-gold-400 text-navy-900" : "text-cream-50 hover:text-gold-400"
                }`}
              >
                {m === "new" ? "New Gear" : "Used Gear"}
              </Link>
            ))}
          </div>
        </div>
      </section>

      <div className="max-w-6xl mx-auto px-6 py-8">
        {listed && (
          <div className="mb-6 bg-green-100 text-green-800 rounded-xl px-4 py-3 text-sm font-semibold">
            Listing published — it&rsquo;s live on the marketplace now.
          </div>
        )}
        {mode === "new" ? <NewGear userId={userId} /> : <UsedGear filters={filters} userId={userId} />}
      </div>
    </div>
  );
}

const CHIPS: { label: string; patch: Partial<MarketplaceFilters> }[] = [
  { label: "Under €100", patch: { maxPriceCents: 10000 } },
  { label: "Collect in person", patch: { delivery: "collection" } },
  { label: "Offers welcome", patch: { saleType: "offers_allowed" } },
  { label: "Auctions", patch: { saleType: "auction" } },
];

function chipHref(filters: MarketplaceFilters, patch: Partial<MarketplaceFilters>, on: boolean): string {
  const next = { ...filters, ...patch };
  if (on) for (const key of Object.keys(patch) as (keyof MarketplaceFilters)[]) (next as Record<string, unknown>)[key] = key.endsWith("Cents") ? null : "";
  const qs = marketplaceFiltersToSearchParams(next).toString();
  return qs ? `/marketplace?${qs}` : "/marketplace";
}

function chipOn(filters: MarketplaceFilters, patch: Partial<MarketplaceFilters>): boolean {
  return (Object.entries(patch) as [keyof MarketplaceFilters, unknown][]).every(([k, v]) => filters[k] === v);
}

async function UsedGear({ filters, userId }: { filters: MarketplaceFilters; userId: string | null }) {
  const supabase = await createClient();
  const browsing = marketplaceFiltersToSearchParams(filters).toString() === "";

  const [{ listings, nextCursor }, brandFacets, featured, banner] = await Promise.all([
    fetchMarketplaceListings(supabase, filters, null, userId, RESULTS_PAGE_SIZE),
    fetchBrandFacets(supabase, filters),
    browsing ? loadListingsForCards(supabase, { featured: true }, userId, 4) : Promise.resolve([]),
    browsing ? loadLiveBanner(supabase, "used_gear") : Promise.resolve(null),
  ]);
  if (banner) await supabase.rpc("banner_seen", { p_banner_id: banner.id });

  return (
    <>
      <div className="flex gap-2 overflow-x-auto pb-1 mb-5">
        {CHIPS.map((c) => {
          const on = chipOn(filters, c.patch);
          return (
            <Link
              key={c.label}
              href={chipHref(filters, c.patch, on)}
              className={`shrink-0 px-4 py-2 rounded-full text-sm font-bold border-[1.5px] transition ${
                on ? "bg-navy-900 border-navy-900 text-gold-400" : "border-line bg-surface text-navy-900 hover:border-navy-900"
              }`}
            >
              {c.label}
            </Link>
          );
        })}
      </div>

      {banner ? (
        <div className="mb-8">
          <SponsoredBanner banner={banner} />
        </div>
      ) : null}

      {featured.length > 0 ? (
        <section className="mb-8">
          <h2 className="font-extrabold text-xl text-navy-900 mb-3">Featured</h2>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {featured.map((l) => (
              <ListingCard key={l.id} listing={l} signedIn={!!userId} />
            ))}
          </div>
        </section>
      ) : null}

      <MarketplaceControls filters={filters} brandFacets={brandFacets} />

      {/* Keyed by the filters so a search/filter/sort change remounts the
       * accumulated "Load more" state rather than appending onto it. */}
      <LoadMoreListings
        key={JSON.stringify(filters)}
        initialListings={listings}
        initialNextCursor={nextCursor}
        filters={filters}
        signedIn={!!userId}
      />
    </>
  );
}

async function NewGear({ userId }: { userId: string | null }) {
  const supabase = await createClient();
  const [banner, stores, stock, deals] = await Promise.all([
    loadLiveBanner(supabase, "new_gear"),
    loadActiveStores(supabase, 12),
    loadListingsForCards(supabase, { anyShop: true }, userId, 12),
    loadAffiliateDeals(supabase, 12),
  ]);
  if (banner) await supabase.rpc("banner_seen", { p_banner_id: banner.id });

  return (
    <div className="space-y-10">
      {banner ? <SponsoredBanner banner={banner} /> : null}

      <section>
        <h2 className="font-extrabold text-xl text-navy-900 mb-3">Pro shops</h2>
        {stores.length === 0 ? (
          <p className="text-ink-500">No pro shops on PinPals yet — yours could be the first.</p>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {stores.map((s) => (
              <Link
                key={s.id}
                href={`/shops/${s.slug}`}
                className="block bg-surface rounded-2xl overflow-hidden shadow-[0_3px_14px_rgba(12,32,56,0.08)] hover:-translate-y-0.5 transition"
              >
                <div className="relative h-24 bg-navy-900">
                  {s.cover_url ? <Image src={s.cover_url} alt="" fill className="object-cover" unoptimized /> : null}
                </div>
                <div className="p-4">
                  <p className="font-extrabold text-navy-900 truncate">{s.name}</p>
                  <p className="text-sm text-ink-500 truncate">{s.clubs?.name ? shortClub(s.clubs.name) : "Pro shop"}</p>
                  <p className="text-xs font-bold text-gold-600 mt-1">
                    {s.offers_fittings ? "Click & collect · Fittings" : "Click & collect"}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      {stock.length > 0 ? (
        <section>
          <h2 className="font-extrabold text-xl text-navy-900 mb-3">From the pro shops</h2>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {stock.map((l) => (
              <ListingCard key={l.id} listing={l} signedIn={!!userId} />
            ))}
          </div>
        </section>
      ) : null}

      {deals.length > 0 ? (
        <section>
          <h2 className="font-extrabold text-xl text-navy-900 mb-1">Top deals from retailers</h2>
          <p className="text-xs text-ink-500 mb-3">PinPals may earn a commission when you buy through these links.</p>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {deals.map((d) => (
              <a
                key={d.id}
                href={`/go/deal/${d.id}`}
                target="_blank"
                rel="noopener sponsored"
                className="block bg-surface rounded-2xl overflow-hidden shadow-[0_3px_14px_rgba(12,32,56,0.08)] hover:-translate-y-0.5 transition"
              >
                <div className="relative aspect-square bg-white">
                  {d.image_url ? <Image src={d.image_url} alt="" fill className="object-contain p-4" unoptimized /> : null}
                  {d.was_price_eur && d.price_eur && d.was_price_eur > d.price_eur ? (
                    <span className="absolute top-3 left-3 text-[11px] font-bold px-2.5 py-1 rounded-full bg-red-600 text-white">
                      −{Math.round((1 - d.price_eur / d.was_price_eur) * 100)}%
                    </span>
                  ) : null}
                </div>
                <div className="p-4">
                  {d.price_eur != null ? (
                    <p className="font-extrabold text-lg text-navy-900">
                      {formatPrice(Number(d.price_eur))}
                      {d.was_price_eur && d.was_price_eur > (d.price_eur ?? 0) ? (
                        <span className="ml-2 text-sm text-ink-500 line-through font-semibold">{formatPrice(Number(d.was_price_eur))}</span>
                      ) : null}
                    </p>
                  ) : null}
                  <p className="text-sm font-semibold text-ink-900 line-clamp-2">{d.title}</p>
                  <p className="text-xs text-ink-500 mt-1">{d.retailer} ↗</p>
                </div>
              </a>
            ))}
          </div>
        </section>
      ) : null}

      <Link
        href="/shops/apply"
        className="flex items-center gap-5 rounded-3xl bg-navy-900 p-6 text-cream-50 hover:brightness-110 transition"
      >
        <span className="text-3xl" aria-hidden>
          🏌️
        </span>
        <span className="flex-1">
          <span className="block font-extrabold text-lg text-gold-400">Run a pro shop?</span>
          <span className="block text-sm text-cream-50/80">
            Sell new stock to the golfers at your club and nearby. Click &amp; collect or post, paid securely — 8% per
            sale, nothing up front.
          </span>
        </span>
        <span className="text-gold-400 font-bold" aria-hidden>
          →
        </span>
      </Link>
    </div>
  );
}

/** A sponsored banner (0115). The tap goes through /go/banner so it's counted. */
function SponsoredBanner({ banner }: { banner: Banner }) {
  return (
    <a
      href={`/go/banner/${banner.id}`}
      target="_blank"
      rel="noopener sponsored"
      className="flex items-center gap-6 rounded-3xl bg-navy-900 text-cream-50 p-7 shadow-[0_6px_24px_rgba(12,32,56,0.25)] hover:brightness-110 transition"
    >
      <div className="flex-1">
        <p className="text-[11px] font-bold tracking-widest uppercase text-gold-400">
          {banner.eyebrow ? `${banner.eyebrow} · ` : ""}Sponsored by {banner.sponsor}
        </p>
        <p className="font-display font-bold text-2xl sm:text-3xl mt-2">{banner.title}</p>
        {banner.subtitle ? <p className="text-cream-50/80 mt-1">{banner.subtitle}</p> : null}
      </div>
      {banner.image_url ? (
        <div className="relative w-36 h-28 shrink-0 hidden sm:block rounded-xl overflow-hidden">
          <Image src={banner.image_url} alt="" fill className="object-cover" unoptimized />
        </div>
      ) : null}
    </a>
  );
}
