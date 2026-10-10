import Image from "next/image";
import Link from "next/link";

import { GOLD_BUTTON } from "@/components/marketplace/buy-styles";
import { createClient } from "@/lib/supabase/server";
import ApplyForm from "./apply-form";

export const metadata = { title: "Sell new gear on PinPals — for pro shops" };

const PERKS = [
  { title: "Golfers on your doorstep", body: "Your stock shows in New Gear for the members of your club and the clubs around you." },
  { title: "Click & collect", body: "Golfers pay online and pick up at the counter — or you post it with tracking." },
  { title: "Paid securely", body: "Card payments through Stripe, paid out to your bank. 8% per sale, nothing up front." },
  { title: "Fittings and lessons", body: "Tell golfers you fit clubs and send them to the shop, not the internet." },
];

/** Apply to sell new stock as a pro shop (0115). PinPals approves every shop. */
export default async function ShopApplyPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let existing: { name: string; status: string } | null = null;
  let country = "ireland";
  if (user) {
    const [{ data: store }, { data: profile }] = await Promise.all([
      supabase.from("stores").select("name, status").eq("owner_id", user.id).maybeSingle<{ name: string; status: string }>(),
      supabase.from("profiles").select("country").eq("id", user.id).maybeSingle<{ country: string | null }>(),
    ]);
    existing = store ?? null;
    country = profile?.country || country;
  }

  return (
    <div>
      <section className="relative overflow-hidden">
        <Image src="/images/dunes.jpg" alt="" fill priority sizes="100vw" className="object-cover" />
        <div className="absolute inset-0 bg-gradient-to-b from-navy-900/60 to-navy-900/85" />
        <div className="relative max-w-4xl mx-auto px-6 py-14">
          <span className="inline-flex items-center gap-2 text-xs font-bold tracking-widest uppercase text-gold-400">
            <span className="w-5 h-0.5 bg-gold-400 inline-block" /> For pro shops
          </span>
          <h1 className="font-display font-bold text-4xl text-cream-50 mt-2">Sell new gear to the golfers at your club.</h1>
          <p className="text-cream-50/85 mt-3 max-w-2xl">
            PinPals is where Ireland&rsquo;s golfers find a game and buy their gear. Put your pro shop in front of them.
          </p>
        </div>
      </section>

      <div className="max-w-4xl mx-auto px-6 py-10 grid lg:grid-cols-[1fr_1.2fr] gap-10">
        <ul className="space-y-5">
          {PERKS.map((p) => (
            <li key={p.title}>
              <p className="font-extrabold text-navy-900">✓ {p.title}</p>
              <p className="text-sm text-ink-500 mt-0.5">{p.body}</p>
            </li>
          ))}
        </ul>

        {!user ? (
          <div className="text-center bg-surface rounded-2xl p-8 shadow-[0_3px_14px_rgba(12,32,56,0.08)]">
            <p className="font-extrabold text-navy-900 text-lg">Join PinPals to apply</p>
            <p className="text-sm text-ink-500 mt-1">It&rsquo;s free. Your shop is linked to your member account.</p>
            <div className="flex gap-3 justify-center mt-5">
              <Link href="/signup" className={GOLD_BUTTON}>Join PinPals</Link>
              <Link href="/login?next=/shops/apply" className="px-5 py-3 font-bold text-navy-900">Log in</Link>
            </div>
          </div>
        ) : existing ? (
          <div className="bg-surface rounded-2xl p-8 shadow-[0_3px_14px_rgba(12,32,56,0.08)]">
            <p className="font-extrabold text-navy-900 text-lg">{existing.name}</p>
            <p className="text-sm text-ink-500 mt-1">
              {existing.status === "pending"
                ? "Your application is with us — we'll let you know as soon as it's approved."
                : existing.status === "active"
                  ? "Your shop is live on PinPals."
                  : "Your shop is paused. Contact PinPals support to talk about it."}
            </p>
            <Link href="/dashboard/shop" className={`${GOLD_BUTTON} mt-5`}>Go to your shop</Link>
          </div>
        ) : (
          <ApplyForm country={country} />
        )}
      </div>
    </div>
  );
}
