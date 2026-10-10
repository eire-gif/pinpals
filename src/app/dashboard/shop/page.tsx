import Link from "next/link";
import { redirect } from "next/navigation";

import { CARD_TITLE, GOLD_BUTTON, SOFT_CARD } from "@/components/marketplace/buy-styles";
import { formatPrice } from "@/lib/format";
import { STORE_COLUMNS, type Store } from "@/lib/marketplace-growth";
import { createClient } from "@/lib/supabase/server";
import ShopDetailsForm from "./shop-details-form";

/**
 * The pro shop owner's page (0115): where the application stands, what's in
 * stock, what's sold and what PinPals kept, and the shop's details.
 */
export default async function MyShopPage({ searchParams }: { searchParams: Promise<{ applied?: string }> }) {
  const { applied } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/dashboard/shop");

  const { data: store } = await supabase.from("stores").select(STORE_COLUMNS).eq("owner_id", user.id).maybeSingle<Store>();
  if (!store) redirect("/shops/apply");

  const [{ data: stock }, { data: sales }, { data: payouts }] = await Promise.all([
    supabase
      .from("listings")
      .select("id, title, price_eur, stock_quantity, status")
      .eq("store_id", store.id)
      .in("status", ["active", "reserved", "draft"])
      .order("created_at", { ascending: false })
      .returns<{ id: number; title: string; price_eur: number | null; stock_quantity: number | null; status: string }[]>(),
    supabase
      .from("orders")
      .select("id, listing_title, amount_eur, delivery_fee_cents, seller_commission_eur, payment_status, payout_status, fulfilment_status, created_at")
      .eq("store_id", store.id)
      .eq("payment_status", "paid")
      .order("created_at", { ascending: false })
      .limit(50)
      .returns<
        {
          id: number;
          listing_title: string;
          amount_eur: number;
          delivery_fee_cents: number | null;
          seller_commission_eur: number;
          payment_status: string;
          payout_status: string | null;
          fulfilment_status: string | null;
          created_at: string;
        }[]
      >(),
    supabase.from("stripe_connected_accounts").select("charges_enabled, payouts_enabled").eq("user_id", user.id).maybeSingle<{ charges_enabled: boolean; payouts_enabled: boolean }>(),
  ]);

  const rows = sales ?? [];
  const takings = rows.reduce((sum, o) => sum + Number(o.amount_eur) + (o.delivery_fee_cents ?? 0) / 100 - Number(o.seller_commission_eur), 0);
  const commission = rows.reduce((sum, o) => sum + Number(o.seller_commission_eur), 0);
  const payoutReady = !!payouts?.charges_enabled && !!payouts?.payouts_enabled;

  return (
    <div className="max-w-5xl mx-auto px-6 py-12">
      <span className="inline-flex items-center gap-2 text-xs font-bold tracking-widest uppercase text-gold-600">
        <span className="w-5 h-0.5 bg-gold-500 inline-block" /> Your pro shop
      </span>
      <div className="flex flex-wrap items-end justify-between gap-4 mt-2">
        <div>
          <h1 className="font-display font-bold text-3xl">{store.name}</h1>
          <p className="text-ink-500">{store.clubs?.name ?? ""}</p>
        </div>
        <div className="flex gap-3">
          {store.status === "active" ? (
            <>
              <Link href={`/shops/${store.slug}`} className="px-5 py-3 rounded-full font-bold border-[1.5px] border-navy-900 text-navy-900">
                View shop
              </Link>
              <Link href="/marketplace/new?shop=1" className={GOLD_BUTTON}>
                List new stock
              </Link>
            </>
          ) : null}
        </div>
      </div>

      {applied ? (
        <div className="mt-6 rounded-2xl bg-green-100 text-green-800 px-5 py-4 text-sm font-semibold">
          Application sent. We check every shop before it goes live — usually within two working days.
        </div>
      ) : null}
      {store.status === "pending" ? (
        <div className={`${SOFT_CARD} mt-6`}>
          <p className={CARD_TITLE}>Awaiting approval</p>
          <p className="text-sm text-ink-500 mt-1">
            While you wait, set up payouts so golfers can pay you the moment you&rsquo;re live.
          </p>
        </div>
      ) : store.status === "suspended" ? (
        <div className="mt-6 rounded-2xl bg-red-100 text-red-600 px-5 py-4 text-sm font-semibold">
          Your shop is paused and can&rsquo;t list new stock. Contact PinPals support.
        </div>
      ) : null}
      {!payoutReady ? (
        <div className="mt-4 rounded-2xl bg-[#f3ead2] px-5 py-4 text-sm text-navy-900">
          <span className="font-bold">Payouts aren&rsquo;t set up yet.</span>{" "}
          <Link href="/dashboard/payouts" className="underline font-semibold">Set up payouts</Link> — it takes a few minutes with Stripe.
        </div>
      ) : null}

      <div className="grid sm:grid-cols-3 gap-4 mt-8">
        <Stat label="Items in stock" value={String((stock ?? []).filter((s) => s.status === "active").length)} />
        <Stat label="Your takings (paid sales)" value={formatPrice(takings)} />
        <Stat label={`PinPals commission (${Math.round(Number(store.commission_rate) * 1000) / 10}%)`} value={formatPrice(commission)} />
      </div>

      <div className="grid lg:grid-cols-2 gap-8 mt-10">
        <section>
          <h2 className={CARD_TITLE}>Stock</h2>
          {(stock ?? []).length === 0 ? (
            <p className="text-sm text-ink-500 mt-2">Nothing listed yet.</p>
          ) : (
            <ul className="mt-3 divide-y divide-line bg-surface rounded-2xl border border-line">
              {(stock ?? []).map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                  <Link href={`/marketplace/${s.id}`} className="font-semibold truncate hover:underline">{s.title}</Link>
                  <span className="text-ink-500 shrink-0">{s.stock_quantity ?? 1} left</span>
                  <span className="font-bold shrink-0">{s.price_eur !== null ? formatPrice(s.price_eur) : ""}</span>
                  <Link href={`/marketplace/${s.id}/edit`} className="text-navy-900 font-bold shrink-0">Edit</Link>
                </li>
              ))}
            </ul>
          )}

          <h2 className={`${CARD_TITLE} mt-8`}>Sales</h2>
          {rows.length === 0 ? (
            <p className="text-sm text-ink-500 mt-2">No sales yet.</p>
          ) : (
            <ul className="mt-3 divide-y divide-line bg-surface rounded-2xl border border-line">
              {rows.map((o) => (
                <li key={o.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                  <Link href={`/dashboard/orders/${o.id}`} className="font-semibold truncate hover:underline">{o.listing_title}</Link>
                  <span className="text-ink-500 shrink-0 capitalize">{(o.fulfilment_status ?? "").replace(/_/g, " ")}</span>
                  <span className="font-bold shrink-0">{formatPrice(Number(o.amount_eur))}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h2 className={`${CARD_TITLE} mb-3`}>Shop details</h2>
          <ShopDetailsForm store={store} />
        </section>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className={SOFT_CARD}>
      <p className="text-xs uppercase tracking-wide text-ink-500 font-semibold">{label}</p>
      <p className="font-extrabold text-2xl text-navy-900 mt-1">{value}</p>
    </div>
  );
}
