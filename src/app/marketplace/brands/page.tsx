import Link from "next/link";
import type { Metadata } from "next";

import { createClient } from "@/lib/supabase/server";
import { EMPTY_MARKETPLACE_FILTERS, fetchBrandFacets } from "@/lib/marketplace-discovery";
import { loadBrandRows, type BrandRow } from "@/lib/marketplace-finder";
import { BrandLogo } from "../finder";

export const metadata: Metadata = {
  title: "Shop by brand — PinPals Marketplace",
  description: "Every golf brand on the PinPals marketplace, with what members have for sale from each.",
};

/**
 * Shop by brand (approved mock-up "Web 1 · Shop by brand", 0163): every
 * brand's logo, most-for-sale first, then A–Z. A tile opens the marketplace
 * with that brand picked, at the finder's next step (club type).
 */
export default async function BrandsPage() {
  const supabase = await createClient();
  const [rows, facets] = await Promise.all([loadBrandRows(supabase), fetchBrandFacets(supabase, EMPTY_MARKETPLACE_FILTERS)]);
  const brands = rows.filter((b) => !b.is_fallback);
  const count = (b: BrandRow) => facets[b.id] ?? 0;
  const popular = [...brands].filter((b) => count(b) > 0).sort((a, b) => count(b) - count(a) || a.label.localeCompare(b.label)).slice(0, 12);
  const byLetter = new Map<string, BrandRow[]>();
  for (const b of [...brands].sort((x, y) => x.label.localeCompare(y.label, "en", { sensitivity: "base" }))) {
    const letter = /[a-z]/i.test(b.label[0]) ? b.label[0].toUpperCase() : "#";
    byLetter.set(letter, [...(byLetter.get(letter) ?? []), b]);
  }

  const tile = (b: BrandRow) => (
    <Link
      key={b.id}
      href={`/marketplace?brand=${encodeURIComponent(b.id)}#finder`}
      className="flex flex-col gap-1.5 rounded-2xl p-2 hover:bg-cream-100 transition"
      aria-label={`${b.label}, ${count(b)} for sale`}
    >
      <BrandLogo brand={b} />
      <span className="text-xs text-center text-ink-500">{count(b) ? `${count(b)} for sale` : "None right now"}</span>
    </Link>
  );

  return (
    <div>
      <section className="bg-navy-900">
        <div className="max-w-6xl mx-auto px-6 pt-10 pb-12">
          <nav aria-label="Breadcrumb" className="text-sm text-[#d9d2c3] flex gap-2">
            <Link href="/marketplace" className="hover:text-cream-50">
              Marketplace
            </Link>
            <span>/</span>
            <span className="text-cream-50">Brands</span>
          </nav>
          <h1 className="font-display font-semibold text-[clamp(34px,5vw,54px)] text-cream-50 mt-4">Shop by brand</h1>
          <p className="text-lg text-[#d9d2c3] mt-2 max-w-xl">
            Pick a brand, then the club and the model — everything members have for sale shows as you go.
          </p>
        </div>
      </section>

      <div className="max-w-6xl mx-auto px-6 py-10 space-y-12">
        {popular.length > 0 ? (
          <section aria-labelledby="popular-h">
            <h2 id="popular-h" className="font-display font-semibold text-3xl text-navy-900 mb-5">
              Most for sale
            </h2>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2">{popular.map(tile)}</div>
          </section>
        ) : null}

        <section aria-labelledby="az-h">
          <h2 id="az-h" className="font-display font-semibold text-3xl text-navy-900 mb-3">
            Every brand, A–Z
          </h2>
          <nav aria-label="Jump to letter" className="flex flex-wrap gap-1.5 mb-6">
            {[...byLetter.keys()].map((l) => (
              <a key={l} href={`#letter-${l}`} className="w-9 h-9 rounded-full border border-line bg-surface flex items-center justify-center text-sm font-bold hover:border-navy-900">
                {l}
              </a>
            ))}
          </nav>
          <div className="space-y-8">
            {[...byLetter.entries()].map(([letter, list]) => (
              <div key={letter} id={`letter-${letter}`} className="scroll-mt-24">
                <h3 className="font-extrabold text-navy-900 mb-2">{letter}</h3>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2">{list.map(tile)}</div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
