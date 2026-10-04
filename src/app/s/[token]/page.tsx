import Link from "next/link";
import type { Metadata } from "next";

import { loadShareCard } from "@/lib/share-card-server";
import { shareCardPath } from "@/lib/share-links";
import { createClient } from "@/lib/supabase/server";

/**
 * A shared post, for anyone with the link (phase 6).
 *
 * Public on purpose — this is what a link preview in WhatsApp or Messages
 * fetches, with no session. It shows the share card (opengraph-image.tsx,
 * next to this file, is also what previews unfurl) and a way in. It never
 * shows the post itself: that stays at /feed/<id>, behind sign-in and the
 * post's own audience. With the app installed, the link opens the app's
 * post screen instead (universal links, .well-known/apple-app-site-association).
 */
export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params;
  const { card } = await loadShareCard(token);
  return {
    title: `${card.pageTitle} · PinPals`,
    description: card.pageDescription,
    openGraph: { title: card.pageTitle, description: card.pageDescription, type: "website", siteName: "PinPals" },
    twitter: { card: "summary_large_image", title: card.pageTitle, description: card.pageDescription },
    // A share page is a doorway, not content worth indexing.
    robots: { index: false, follow: false },
  };
}

export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { payload, card } = await loadShareCard(token);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const postHref = payload ? `/feed/${payload.p}` : "/feed";

  return (
    <div className="max-w-[720px] mx-auto px-4 sm:px-6 py-10 grid gap-6">
      {/* eslint-disable-next-line @next/next/no-img-element -- a generated PNG at a fixed size; nothing for next/image to optimise */}
      <img
        src={shareCardPath(token)}
        alt={card.pageTitle}
        width={1200}
        height={630}
        className="w-full h-auto rounded-2xl border border-line shadow-sm"
      />
      <div className="grid gap-2">
        <h1 className="font-display text-3xl text-ink-900">{card.pageTitle}</h1>
        <p className="text-ink-500">{card.pageDescription}</p>
      </div>
      <div className="flex flex-wrap gap-3">
        {user ? (
          <Link href={postHref} className="rounded-full bg-green-700 text-cream-50 font-bold px-6 py-3 hover:bg-green-800">
            Open the post
          </Link>
        ) : (
          <>
            <Link href="/signup" className="rounded-full bg-green-700 text-cream-50 font-bold px-6 py-3 hover:bg-green-800">
              Join PinPals — it&apos;s free
            </Link>
            <Link
              href={`/login?next=${encodeURIComponent(postHref)}`}
              className="rounded-full border border-line bg-surface text-ink-900 font-bold px-6 py-3 hover:bg-surface-tint"
            >
              Sign in to see the post
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
