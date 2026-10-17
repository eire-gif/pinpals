import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { initials } from "@/lib/format";
import { FEEDBACK_MAX_LENGTH, FEEDBACK_TAG_LABELS, TAGS_FOR, saleSummary } from "@/lib/marketplace-cash";
import { declineSaleAction, leaveFeedbackAction } from "../../cash-actions";

export const metadata: Metadata = { title: "Leave feedback | Pinpals Marketplace", robots: { index: false } };

/**
 * Leave feedback (cash marketplace, 0160; mock-up 7 on the website). The
 * "leave feedback" alert links here, and the app opens its own screen for the
 * same href. Good / Not good, tags, a comment — shown on the other person's
 * marketplace page once they've left theirs, or after a week.
 */
export default async function FeedbackPage({
  params,
  searchParams,
}: {
  params: Promise<{ saleId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { saleId: raw } = await params;
  const saleId = Number.parseInt(raw, 10);
  if (!Number.isInteger(saleId) || saleId <= 0) notFound();
  const error = (await searchParams).error;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/marketplace/feedback/${saleId}`);

  const sale = await saleSummary(supabase, saleId);
  if (!sale || !sale.other) notFound();

  const first = sale.other.name.split(" ")[0];
  const theirRole = sale.myRole === "seller" ? "buyer" : "seller";

  let done: { title: string; body: string } | null = null;
  if (sale.declined) {
    done = { title: "Feedback closed", body: sale.myRole === "seller" ? `${first} said they didn't buy this.` : "You said you didn't buy this." };
  } else if (sale.iLeft) {
    done = {
      title: "Thanks — feedback sent",
      body: sale.theyLeft ? "You'll both see each other's feedback now." : `It shows on ${first}'s marketplace page once they leave theirs, or in 7 days.`,
    };
  } else if (sale.closed) {
    done = { title: "Feedback closed", body: "Feedback stays open for 30 days after a sale." };
  }

  return (
    <div className="max-w-xl mx-auto px-6 py-14">
      <div className="text-center grid justify-items-center gap-2">
        <span
          className="w-[72px] h-[72px] rounded-full flex items-center justify-center text-white font-display font-bold text-2xl"
          style={{ background: sale.other.avatarColor ?? "#1f5c2e" }}
          aria-hidden
        >
          {initials(sale.other.name)}
        </span>
        {done ? (
          <>
            <h1 className="font-display font-bold text-3xl">{done.title}</h1>
            <p className="text-ink-500">{done.body}</p>
            <Link href={`/marketplace/sellers/${sale.other.id}`} className="mt-4 font-bold text-green-700">
              See {first}&rsquo;s marketplace page &rarr;
            </Link>
          </>
        ) : (
          <>
            <h1 className="font-display font-bold text-3xl">
              How was {sale.myRole === "buyer" ? "buying from" : "selling to"} {first}?
            </h1>
            <p className="text-ink-500">{sale.title}</p>
            {sale.theyLeft ? <p className="text-sm font-semibold text-green-700">{first} has left theirs — leave yours to see it.</p> : null}
          </>
        )}
      </div>

      {done ? null : (
        <>
          <form action={leaveFeedbackAction} className="grid gap-6 mt-8">
            <input type="hidden" name="sale_id" value={saleId} />
            <fieldset className="grid grid-cols-2 gap-3">
              <legend className="sr-only">Verdict</legend>
              <label className="flex flex-col items-center justify-center gap-2 h-28 rounded-2xl border border-cream-100 bg-surface cursor-pointer font-bold has-[:checked]:border-2 has-[:checked]:border-green-700 has-[:checked]:bg-green-100 has-[:checked]:text-green-800">
                <input type="radio" name="verdict" value="good" className="sr-only" />
                <span className="text-3xl" aria-hidden>👍</span>
                Good
              </label>
              <label className="flex flex-col items-center justify-center gap-2 h-28 rounded-2xl border border-cream-100 bg-surface cursor-pointer font-bold has-[:checked]:border-2 has-[:checked]:border-red-600 has-[:checked]:bg-red-100 has-[:checked]:text-red-600">
                <input type="radio" name="verdict" value="bad" className="sr-only" />
                <span className="text-3xl" aria-hidden>👎</span>
                Not good
              </label>
            </fieldset>

            <fieldset className="grid gap-2">
              <legend className="text-sm font-bold mb-2">
                What went well? <span className="font-normal text-ink-500">Tap any</span>
              </legend>
              <div className="flex flex-wrap gap-2">
                {TAGS_FOR[theirRole].map((tag) => (
                  <label
                    key={tag}
                    className="px-3.5 py-2 rounded-full border border-cream-100 bg-surface text-sm font-semibold cursor-pointer has-[:checked]:border-green-700 has-[:checked]:bg-green-100 has-[:checked]:text-green-800"
                  >
                    <input type="checkbox" name="tags" value={tag} className="sr-only" />
                    {FEEDBACK_TAG_LABELS[tag]}
                  </label>
                ))}
              </div>
            </fieldset>

            <label className="grid gap-1.5">
              <span className="text-sm font-bold">
                Add a comment <span className="font-normal text-ink-500">Optional</span>
              </span>
              <textarea name="body" rows={3} maxLength={FEEDBACK_MAX_LENGTH} className="rounded-xl border border-cream-100 bg-surface p-3 text-base" />
            </label>

            <p className="text-xs text-ink-500 text-center">
              Shows on {first}&rsquo;s marketplace page only. Hidden until {first} leaves theirs, or after 7 days.
            </p>

            {typeof error === "string" ? <p className="text-sm font-semibold text-red-600 text-center">{error}</p> : null}

            <button type="submit" className="py-3.5 rounded-full font-bold bg-navy-900 text-gold-400 hover:brightness-110 transition">
              Send feedback
            </button>
          </form>

          {sale.myRole === "buyer" ? (
            <form action={declineSaleAction} className="mt-4 text-center">
              <input type="hidden" name="sale_id" value={saleId} />
              <button type="submit" className="text-sm font-semibold text-ink-500 underline">
                I didn&rsquo;t buy this
              </button>
            </form>
          ) : null}
        </>
      )}
    </div>
  );
}
