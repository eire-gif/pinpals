import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";

import ListingCard from "@/app/marketplace/listing-card";
import { createClient } from "@/lib/supabase/server";
import { FEED_SCOPE_LABELS, FEED_SCOPES, parseFeedScope } from "@/lib/feed";
import { getFeedPage } from "@/lib/feed-server";
import type { Profile } from "@/lib/types";
import Composer from "./composer";
import PostCard from "./post-card";

export const metadata: Metadata = {
  title: "Social · PinPals",
  description: "Rounds, photos and news from PinPals members.",
};

/**
 * The feed: what members are playing, posting and selling.
 *
 * Server-rendered page by page, with "Older posts" as a plain link carrying
 * the cursor. No infinite scroll on the website: a link is shareable,
 * back-button-safe and needs no client state, and this is the page people
 * open to catch up rather than to scroll for an hour. The app scrolls.
 */
export default async function FeedPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string; before?: string }>;
}) {
  const { scope: scopeParam, before: beforeParam } = await searchParams;
  const scope = parseFeedScope(scopeParam);
  // Only a timestamp is accepted as a cursor. Anything else is ignored
  // rather than passed into a filter.
  const before = beforeParam && !Number.isNaN(Date.parse(beforeParam)) ? beforeParam : null;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const header = (
    <div className="relative bg-navy-900 text-white pt-16 pb-14 overflow-hidden">
      <Image src="/images/old-head-kinsale.jpg" alt="" fill priority className="object-cover -z-10 opacity-45" />
      <div className="absolute inset-0 bg-gradient-to-b from-[rgba(9,22,40,0.5)] to-[rgba(9,22,40,0.92)] -z-10" />
      <div className="max-w-6xl mx-auto px-6">
        <span className="inline-flex items-center gap-2 text-xs font-bold tracking-widest uppercase text-gold-500">
          <span className="w-5 h-0.5 bg-gold-500 inline-block" /> Social
        </span>
        <h1 className="font-display font-bold text-4xl mt-2.5">From the fairways.</h1>
        <p className="text-white/80 mt-3 max-w-[52ch]">
          Rounds, photos and the odd miracle par save — shared by PinPals members, with new kit from the marketplace along the way.
        </p>
      </div>
    </div>
  );

  if (!user) {
    return (
      <div>
        {header}
        <div className="max-w-6xl mx-auto px-6 py-16 text-center">
          <div className="bg-surface rounded-2xl shadow-lg p-10 max-w-md mx-auto">
            <h2 className="font-display font-bold text-2xl mb-2">Join to see the feed.</h2>
            <p className="text-ink-500 mb-6">
              The feed is for members only — so a photo of your fourball is only ever seen by fellow golfers.
            </p>
            <Link href="/signup" className="inline-block px-6 py-3 rounded-full font-bold bg-green-700 text-cream-50 hover:bg-green-600 transition">
              Join PinPals
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const [{ data: me }, page] = await Promise.all([
    supabase
      .from("profiles")
      .select("first_name, last_name, avatar_url, avatar_color, country")
      .eq("id", user.id)
      .maybeSingle<Pick<Profile, "first_name" | "last_name" | "avatar_url" | "avatar_color" | "country">>(),
    getFeedPage(supabase, user.id, { scope, before }),
  ]);

  const myName = [me?.first_name, me?.last_name].filter(Boolean).join(" ") || "You";

  const olderHref = page.nextCursor
    ? `/feed?${new URLSearchParams({ ...(scope === "all" ? {} : { scope }), before: page.nextCursor }).toString()}`
    : null;

  return (
    <div>
      {header}

      <div className="max-w-[680px] mx-auto px-4 sm:px-6 py-8 grid gap-5">
        {!before && (
          <Composer
            me={{
              name: myName,
              avatarUrl: me?.avatar_url ?? null,
              avatarColor: me?.avatar_color ?? null,
              country: me?.country ?? "IE",
            }}
          />
        )}

        <nav aria-label="Whose posts to show" className="flex gap-2">
          {FEED_SCOPES.map((s) => {
            const active = s === scope;
            return (
              <Link
                key={s}
                href={s === "all" ? "/feed" : `/feed?scope=${s}`}
                aria-current={active ? "page" : undefined}
                className={`px-4 py-2 rounded-full text-sm font-bold border-[1.5px] transition ${
                  active ? "bg-navy-900 border-navy-900 text-white" : "border-line text-ink-900 hover:bg-cream-100"
                }`}
              >
                {FEED_SCOPE_LABELS[s]}
              </Link>
            );
          })}
          <Link
            href={`/members/${user.id}`}
            className="ml-auto px-4 py-2 rounded-full text-sm font-bold text-green-700 hover:bg-green-100 transition"
          >
            My posts
          </Link>
        </nav>

        {page.noConnections ? (
          <Empty
            title="No connections yet."
            body="Posts from golfers you connect with show up here. Find people you play with and send them a request."
            href="/community"
            cta="Find golfers"
          />
        ) : page.entries.length === 0 ? (
          before ? (
            <Empty title="That's everything." body="You've reached the start of the feed." href="/feed" cta="Back to the latest" />
          ) : (
            <Empty
              title="Be the first to post."
              body="Share a photo from your last round — the view from the 7th, the scorecard, the fourball."
            />
          )
        ) : (
          page.entries.map((entry) =>
            entry.kind === "post" ? (
              <PostCard key={`p${entry.item.id}`} post={entry.item} />
            ) : (
              <section key={`l${entry.item.id}`} aria-label="New in the marketplace" className="bg-surface-tint border border-line rounded-2xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="inline-flex items-center gap-2 text-[11px] font-bold tracking-widest uppercase text-gold-600">
                    <span className="w-4 h-0.5 bg-gold-500 inline-block" /> New in the marketplace
                  </span>
                  <Link href="/marketplace" className="text-xs font-bold text-green-700 hover:underline">
                    Browse all
                  </Link>
                </div>
                <div className="max-w-[320px] mx-auto sm:mx-0">
                  <ListingCard listing={entry.item} signedIn />
                </div>
              </section>
            )
          )
        )}

        {olderHref && (
          <Link
            href={olderHref}
            className="justify-self-center px-6 py-3 rounded-full font-bold text-sm border-[1.5px] border-line hover:bg-cream-100 transition"
          >
            Older posts
          </Link>
        )}
      </div>
    </div>
  );
}

function Empty({ title, body, href, cta }: { title: string; body: string; href?: string; cta?: string }) {
  return (
    <div className="bg-surface border border-line rounded-2xl p-10 text-center">
      <h2 className="font-display font-bold text-xl">{title}</h2>
      <p className="text-ink-500 mt-2 max-w-[42ch] mx-auto">{body}</p>
      {href && cta && (
        <Link href={href} className="inline-block mt-5 px-6 py-3 rounded-full font-bold text-sm bg-green-700 text-cream-50 hover:bg-green-600 transition">
          {cta}
        </Link>
      )}
    </div>
  );
}
