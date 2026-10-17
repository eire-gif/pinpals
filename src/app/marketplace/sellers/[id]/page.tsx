import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { initials } from "@/lib/format";
import { FEEDBACK_TAG_LABELS, memberFeedback, memberRecord, positiveShare } from "@/lib/marketplace-cash";
import { FeedbackItem } from "../../[id]/cash-listing";

export const metadata: Metadata = { title: "Seller | Pinpals Marketplace", robots: { index: false } };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A member's marketplace page (cash marketplace, 0160; mock-up 4) — the only
 * place their marketplace feedback is shown. Their golf profile never shows
 * it, on purpose.
 */
export default async function SellerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();

  const supabase = await createClient();
  const [{ data: profile }, record, entries, { data: listings }] = await Promise.all([
    supabase
      .from("profiles")
      .select("first_name, last_name, home_club, avatar_color, created_at")
      .eq("id", id)
      .maybeSingle<{ first_name: string | null; last_name: string | null; home_club: string | null; avatar_color: string | null; created_at: string | null }>(),
    memberRecord(supabase, id),
    memberFeedback(supabase, id, 30),
    supabase
      .from("listings")
      .select("id, title, price_eur, image_url")
      .eq("seller_id", id)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(12)
      .returns<{ id: number; title: string; price_eur: number | null; image_url: string | null }[]>(),
  ]);
  if (!profile) notFound();

  const name = [profile.first_name, profile.last_name].filter(Boolean).join(" ") || "A member";
  const total = record.positive + record.negative;
  const since = profile.created_at
    ? new Intl.DateTimeFormat("en-IE", { month: "short", year: "numeric" }).format(new Date(profile.created_at))
    : null;

  return (
    <div className="max-w-3xl mx-auto px-6 py-14 grid gap-8">
      <Link href="/marketplace" className="text-sm text-green-700 font-bold">
        &larr; Back to marketplace
      </Link>

      <div className="text-center grid justify-items-center gap-2">
        <span
          className="w-[84px] h-[84px] rounded-full flex items-center justify-center text-white font-display font-bold text-3xl"
          style={{ background: profile.avatar_color ?? "#1f5c2e" }}
          aria-hidden
        >
          {initials(name)}
        </span>
        <h1 className="font-display font-bold text-3xl">{name}</h1>
        <p className="text-ink-500">{[profile.home_club, since ? `On PinPals since ${since}` : null].filter(Boolean).join(" · ")}</p>
      </div>

      <div className="bg-surface rounded-2xl p-6 shadow-[0_3px_14px_rgba(12,32,56,0.08)] grid gap-3">
        <div className="flex items-baseline justify-between">
          <h2 className="font-bold text-lg">Marketplace feedback</h2>
          <span className="text-sm font-bold text-green-700">{positiveShare(record) ?? "No feedback yet"}</span>
        </div>
        <Bar label="Positive" count={record.positive} of={total} className="bg-green-700" />
        <Bar label="Negative" count={record.negative} of={total} className="bg-red-600" />
        <p className="text-sm text-ink-500">
          {record.sales} {record.sales === 1 ? "sale" : "sales"} on PinPals
        </p>
        {record.tags.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {record.tags.slice(0, 6).map((t) => (
              <span key={t.tag} className="text-xs font-semibold px-2.5 py-1 rounded-full bg-cream-100">
                {FEEDBACK_TAG_LABELS[t.tag]} <span className="text-ink-500">· {t.count}</span>
              </span>
            ))}
          </div>
        ) : null}
      </div>

      <section>
        <h2 className="font-display font-bold text-xl mb-3">What people say</h2>
        {entries.length === 0 ? (
          <p className="text-sm text-ink-500">No feedback yet. It appears once both sides of a sale have left theirs, or a week after.</p>
        ) : (
          <ul className="grid gap-3">
            {entries.map((entry) => (
              <FeedbackItem key={entry.id} entry={entry} />
            ))}
          </ul>
        )}
      </section>

      {listings && listings.length > 0 ? (
        <section>
          <h2 className="font-display font-bold text-xl mb-3">For sale by {name.split(" ")[0]}</h2>
          <ul className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            {listings.map((l) => (
              <li key={l.id}>
                <Link href={`/marketplace/${l.id}`} className="block">
                  {l.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={l.image_url} alt="" className="aspect-square w-full rounded-2xl object-cover" />
                  ) : (
                    <div className="aspect-square w-full rounded-2xl bg-cream-100" aria-hidden />
                  )}
                  <span className="block font-extrabold mt-2">{l.price_eur !== null ? `€${l.price_eur.toLocaleString("en-IE")}` : ""}</span>
                  <span className="block text-sm truncate">{l.title}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function Bar({ label, count, of, className }: { label: string; count: number; of: number; className: string }) {
  const width = of > 0 ? Math.max(count > 0 ? 3 : 0, Math.round((count / of) * 100)) : 0;
  return (
    <div className="flex items-center gap-3">
      <span className="w-10 font-extrabold text-lg">{count}</span>
      <span className="flex-1 h-2 rounded-full bg-cream-100 overflow-hidden">
        <span className={`block h-2 rounded-full ${className}`} style={{ width: `${width}%` }} />
      </span>
      <span className="w-16 text-xs text-ink-500">{label}</span>
    </div>
  );
}
