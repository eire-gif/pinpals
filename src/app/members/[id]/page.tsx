import Image from "next/image";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";

import ConnectButton from "@/app/community/connect-button";
import ListingCard from "@/app/marketplace/listing-card";
import PostCard from "@/app/feed/post-card";
import MemberAvatar from "@/components/member-avatar";
import { AGE_BAND_NOT_SHARED } from "@/lib/age";
import { getMemberPostCount, getMemberPosts } from "@/lib/feed-server";
import { formatJoinedDate } from "@/lib/format";
import { enrichListings } from "@/lib/marketplace-discovery";
import { countryName } from "@/lib/regions";
import { createClient } from "@/lib/supabase/server";
import type { Connection, Listing, Profile } from "@/lib/types";

export const metadata: Metadata = { title: "Member · PinPals" };

const TABS = [
  { key: "posts", label: "Posts" },
  { key: "selling", label: "For sale" },
] as const;

/**
 * A member's own page: who they are, what they've posted, what they're
 * selling.
 *
 * Every read is the viewer's own client, so 0088 decides which posts appear
 * — a stranger sees only the posts this member shared with all members,
 * a connection sees the rest too, and a member who has blocked the viewer
 * (or been blocked by them) shows no posts at all. Nothing here re-decides
 * that.
 *
 * Profiles themselves are readable by any signed-in member (0001), as they
 * already are in the directory, and handicap and age honour the member's
 * own sharing choices exactly as the directory card does.
 */
export default async function MemberPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; before?: string }>;
}) {
  const { id } = await params;
  const { tab: tabParam, before: beforeParam } = await searchParams;
  const tab = tabParam === "selling" ? "selling" : "posts";
  const before = beforeParam && !Number.isNaN(Date.parse(beforeParam)) ? beforeParam : null;

  // A uuid, or nothing. Anything else would only reach the database to be
  // refused there.
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/members/${id}`);

  const { data: member } = await supabase.from("profiles").select("*").eq("id", id).maybeSingle<Profile>();
  if (!member) notFound();

  const isMe = member.id === user.id;

  const [ageBandResult, connectionResult, postCount, posts, listingsResult] = await Promise.all([
    supabase
      .from("member_age_bands")
      .select("age_band")
      .eq("user_id", member.id)
      .maybeSingle<{ age_band: string }>(),
    isMe
      ? Promise.resolve({ data: null })
      : supabase
          .from("connections")
          .select("*")
          .or(
            `and(requester_id.eq.${user.id},recipient_id.eq.${member.id}),and(requester_id.eq.${member.id},recipient_id.eq.${user.id})`
          )
          .maybeSingle<Connection>(),
    getMemberPostCount(supabase, member.id),
    tab === "posts" ? getMemberPosts(supabase, user.id, member.id, before) : Promise.resolve(null),
    supabase
      .from("listings")
      .select("*")
      .eq("seller_id", member.id)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(24)
      .returns<Listing[]>(),
  ]);

  const listings = tab === "selling" ? await enrichListings(supabase, listingsResult.data ?? [], user.id) : [];
  const forSaleCount = listingsResult.data?.length ?? 0;

  const name = `${member.first_name} ${member.last_name}`.trim() || "A member";
  const firstName = member.first_name || "This member";
  const connection = connectionResult.data;
  const handicap = member.handicap != null && member.handicap_visible ? String(member.handicap) : AGE_BAND_NOT_SHARED;
  const place = [member.county, member.country ? countryName(member.country) : null].filter(Boolean).join(", ");

  const tabHref = (key: string) => (key === "posts" ? `/members/${member.id}` : `/members/${member.id}?tab=${key}`);

  return (
    <div>
      <div className="relative bg-navy-900 text-white overflow-hidden">
        <Image src="/images/ballybunion-10th.jpg" alt="" fill priority className="object-cover -z-10 opacity-40" />
        <div className="absolute inset-0 bg-gradient-to-b from-[rgba(9,22,40,0.45)] to-[rgba(9,22,40,0.94)] -z-10" />
        <div className="max-w-4xl mx-auto px-6 pt-14 pb-10 flex flex-col sm:flex-row sm:items-end gap-6">
          <div className="rounded-full ring-4 ring-gold-500/80 self-start">
            <MemberAvatar name={name} avatarUrl={member.avatar_url} color={member.avatar_color} size="xl" className="!w-24 !h-24 !text-3xl" />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="font-display font-bold text-3xl sm:text-4xl">{name}</h1>
            <p className="text-white/80 mt-1.5">
              {member.home_club ? (
                <span className="font-semibold text-gold-400">{member.home_club}</span>
              ) : (
                <span className="italic">No home club set</span>
              )}
              {place && <span> · {place}</span>}
            </p>
            <p className="text-white/60 text-sm mt-1">{formatJoinedDate(member.created_at)}</p>
          </div>
          {isMe && (
            <Link
              href="/profile/edit"
              className="sm:self-end px-5 py-2.5 rounded-full font-bold text-sm bg-white/10 border border-white/25 hover:bg-white/20 transition"
            >
              Edit profile
            </Link>
          )}
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 grid md:grid-cols-[260px_1fr] gap-6 items-start">
        <aside className="bg-surface border border-line rounded-2xl p-5 grid gap-4 md:sticky md:top-24">
          {/* The same control as the directory card — connect, or message
              once connected — so it behaves identically in both places. */}
          {!isMe && (
            <div className="border-b border-line pb-4">
              <ConnectButton
                memberId={member.id}
                initialStatus={connection?.status}
                incoming={connection?.recipient_id === user.id}
              />
            </div>
          )}
          <dl className="grid grid-cols-3 md:grid-cols-1 gap-4">
            <div>
              <dt className="text-xs text-ink-500">Handicap</dt>
              <dd className="font-display font-bold text-xl">{handicap}</dd>
            </div>
            <div>
              <dt className="text-xs text-ink-500">Posts</dt>
              <dd className="font-display font-bold text-xl">{postCount}</dd>
            </div>
            <div>
              <dt className="text-xs text-ink-500">Age range</dt>
              <dd className="font-semibold">{ageBandResult.data?.age_band ?? AGE_BAND_NOT_SHARED}</dd>
            </div>
          </dl>
          {member.bio && (
            <div className="border-t border-line pt-4">
              <h2 className="text-xs text-ink-500 mb-1">About</h2>
              <p className="text-sm whitespace-pre-line break-words">{member.bio}</p>
            </div>
          )}
        </aside>

        <div className="grid gap-5 min-w-0">
          <nav aria-label="Member sections" className="flex gap-2">
            {TABS.map((t) => (
              <Link
                key={t.key}
                href={tabHref(t.key)}
                aria-current={tab === t.key ? "page" : undefined}
                className={`px-4 py-2 rounded-full text-sm font-bold border-[1.5px] transition ${
                  tab === t.key ? "bg-navy-900 border-navy-900 text-white" : "border-line hover:bg-cream-100"
                }`}
              >
                {t.label}
                {t.key === "selling" && forSaleCount > 0 && <span className="ml-1.5 opacity-70">{forSaleCount}</span>}
              </Link>
            ))}
          </nav>

          {tab === "posts" && posts && (
            <>
              {posts.posts.length === 0 ? (
                <div className="bg-surface border border-line rounded-2xl p-10 text-center text-ink-500">
                  {isMe ? (
                    <>
                      You haven&rsquo;t posted yet.{" "}
                      <Link href="/feed" className="font-bold text-green-700 hover:underline">
                        Share your last round
                      </Link>
                    </>
                  ) : (
                    `${firstName} hasn't shared anything you can see yet.`
                  )}
                </div>
              ) : (
                posts.posts.map((post) => <PostCard key={post.id} post={post} />)
              )}
              {posts.nextCursor && (
                <Link
                  href={`/members/${member.id}?before=${encodeURIComponent(posts.nextCursor)}`}
                  className="justify-self-center px-6 py-3 rounded-full font-bold text-sm border-[1.5px] border-line hover:bg-cream-100 transition"
                >
                  Older posts
                </Link>
              )}
            </>
          )}

          {tab === "selling" &&
            (listings.length === 0 ? (
              <div className="bg-surface border border-line rounded-2xl p-10 text-center text-ink-500">
                {isMe ? "You have nothing listed right now." : `${firstName} has nothing for sale right now.`}
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {listings.map((listing) => (
                  <ListingCard key={listing.id} listing={listing} signedIn />
                ))}
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}
