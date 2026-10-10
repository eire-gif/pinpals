import Image from "next/image";
import { notFound } from "next/navigation";

import ListingCard from "@/app/marketplace/listing-card";
import { STORE_COLUMNS, loadListingsForCards, type Store } from "@/lib/marketplace-growth";
import { createClient } from "@/lib/supabase/server";

/**
 * A pro shop's storefront (0115) — the website twin of the app's
 * store/[id] screen. Active shops only (RLS: visitors see active shops; the
 * owner and staff also see their pending one, labelled).
 */
export default async function ShopPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: store } = await supabase.from("stores").select(STORE_COLUMNS).eq("slug", slug).maybeSingle<Store>();
  if (!store) notFound();
  const items = await loadListingsForCards(supabase, { storeId: store.id }, user?.id ?? null, 60);

  return (
    <div>
      <section className="relative overflow-hidden bg-navy-900">
        {store.cover_url ? (
          <Image src={store.cover_url} alt="" fill priority sizes="100vw" className="object-cover" unoptimized />
        ) : (
          <Image src="/images/marketplace-header.jpg" alt="" fill priority sizes="100vw" className="object-cover" />
        )}
        <div className="absolute inset-0 bg-navy-900/60" />
        <div className="relative max-w-6xl mx-auto px-6 py-12 flex items-center gap-5">
          <div className="relative w-20 h-20 rounded-2xl overflow-hidden border-2 border-gold-400 bg-navy-900 shrink-0">
            {store.logo_url ? <Image src={store.logo_url} alt="" fill className="object-cover" unoptimized /> : null}
          </div>
          <div>
            <p className="text-[11px] font-bold tracking-widest uppercase text-gold-400">
              Pro shop · {store.status === "active" ? "PinPals approved" : "Awaiting approval"}
            </p>
            <h1 className="font-display font-bold text-3xl sm:text-4xl text-cream-50 mt-1">{store.name}</h1>
            {store.clubs?.name ? <p className="text-cream-50/85">{store.clubs.name}</p> : null}
          </div>
        </div>
      </section>

      <div className="max-w-6xl mx-auto px-6 py-8">
        <div className="flex flex-wrap gap-2">
          {["Click & collect", "Tracked post", ...(store.offers_fittings ? ["Fittings"] : []), "All new"].map((p) => (
            <span key={p} className="px-3.5 py-1.5 rounded-full bg-[#f3ead2] text-navy-900 text-sm font-semibold">
              {p}
            </span>
          ))}
        </div>
        {store.description ? <p className="mt-5 max-w-3xl text-ink-900 whitespace-pre-line">{store.description}</p> : null}
        {store.phone || store.email ? (
          <p className="mt-3 text-sm text-ink-500">
            {[store.phone, store.email].filter(Boolean).join(" · ")}
          </p>
        ) : null}

        <h2 className="font-extrabold text-xl text-navy-900 mt-10 mb-3">In stock{items.length ? ` · ${items.length}` : ""}</h2>
        {items.length === 0 ? (
          <p className="text-ink-500">Nothing listed just yet — check back soon.</p>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {items.map((l) => (
              <ListingCard key={l.id} listing={l} signedIn={!!user} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
