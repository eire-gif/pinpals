import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";

import InterestButton from "@/app/tee-times/interest-button";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { loadSharedTeeTime } from "@/lib/tee-time-share-server";
import type { InterestStatus } from "@/lib/types";

/**
 * A round with an open place, sent by its host or one of its players (0132).
 *
 * Public on purpose: the person it was sent to may not be on PinPals yet,
 * and a link preview has no session. It shows only the course, day, time,
 * places and first names (tee-time-share-server.ts).
 *
 * Signed in, opening it adds you to the round's invitations — so you can
 * see it and ask for the place — and the I'm interested button works here.
 * In the app the same link opens the round natively (mobile tee-link.tsx).
 * Not indexed.
 */
export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params;
  const t = await loadSharedTeeTime(token);
  const title = t ? `A place at ${t.clubName}` : "A round on PinPals";
  const description = t ? `${t.dateLabel} · ${t.timeLabel} · ${t.spaces} ${t.spaces === 1 ? "place" : "places"} left. ${t.sharerFirstName} thought of you.` : "Golfers in Ireland swapping tee times, scores and gear.";
  return {
    title: `${title} · PinPals`,
    description,
    openGraph: { title, description, type: "website", siteName: "PinPals" },
    twitter: { card: "summary", title, description },
    robots: { index: false, follow: false },
  };
}

export default async function SharedTeeTimePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const t = await loadSharedTeeTime(token);

  if (!t) {
    return (
      <div className="max-w-[560px] mx-auto px-4 sm:px-6 py-16 grid gap-4 text-center">
        <h1 className="font-display text-3xl text-ink-900">This round has filled up</h1>
        <p className="text-ink-500">Or it&apos;s been played or cancelled. There are more games looking for golfers on PinPals.</p>
        <div className="flex flex-wrap justify-center gap-3">
          <Link href="/tee-times" className="inline-block rounded-full bg-green-700 text-cream-50 font-bold px-6 py-3 hover:bg-green-800">
            Find a game
          </Link>
          <Link href="/signup" className="inline-block rounded-full border border-line bg-surface text-navy-900 font-bold px-6 py-3">
            Join PinPals — it&apos;s free
          </Link>
        </div>
      </div>
    );
  }

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  const user = auth.user;

  // Signed in: add them to the round (0132), then read back their request, if any.
  let canAsk = false;
  let status: InterestStatus | undefined;
  if (user) {
    const { data: ok } = await createAdminClient().rpc("tee_time_link_claim", { p_invite_id: t.inviteId, p_sharer: t.sharerId, p_member: user.id });
    canAsk = ok === true;
    const { data: mine } = await supabase
      .from("tee_time_interests")
      .select("status")
      .eq("invite_id", t.inviteId)
      .eq("member_id", user.id)
      .maybeSingle<{ status: InterestStatus }>();
    status = mine?.status;
  }
  const { data: own } = user
    ? await supabase.from("tee_time_invites").select("member_id").eq("id", t.inviteId).maybeSingle<{ member_id: string }>()
    : { data: null };
  const mineToHost = !!user && own?.member_id === user.id;
  const next = encodeURIComponent(`/t/${token}`);

  return (
    <div className="relative min-h-[80vh] flex items-center justify-center px-4 sm:px-6 py-16 overflow-hidden">
      <Image src="/images/homepage-hero.jpg" alt="" fill priority sizes="100vw" className="object-cover" />
      <div className="absolute inset-0 bg-navy-900/70" />
      <div className="relative w-full max-w-md bg-surface rounded-3xl p-8 shadow-[0_12px_40px_rgba(12,32,56,0.35)]">
        <p className="text-xs font-bold tracking-widest uppercase text-gold-600 text-center">
          {t.sharerFirstName} has a place for you
        </p>
        <h1 className="font-display font-bold text-3xl text-navy-900 mt-2 text-center text-balance">{t.clubName}</h1>
        {t.place ? <p className="text-ink-500 text-center mt-1">{t.place}</p> : null}

        <dl className="grid grid-cols-2 gap-3 my-6">
          <div className="rounded-2xl bg-cream-100 p-3">
            <dt className="text-xs font-bold uppercase tracking-wide text-ink-500">When</dt>
            <dd className="font-bold text-ink-900 mt-0.5">{t.dateLabel}</dd>
            <dd className="text-sm text-ink-900">{t.timeLabel}</dd>
          </div>
          <div className="rounded-2xl bg-green-100 p-3">
            <dt className="text-xs font-bold uppercase tracking-wide text-green-800">Open</dt>
            <dd className="font-display text-2xl text-green-800 tabular-nums">{t.spaces}</dd>
            <dd className="text-sm text-green-800">{t.spaces === 1 ? "place left" : "places left"}</dd>
          </div>
        </dl>
        <p className="text-sm text-ink-900 text-center">
          {t.hostFirstName} is hosting.{t.ladiesOnly ? " Ladies only." : ""} Ask for the place and {t.hostFirstName} confirms it.
        </p>

        <div className="mt-6 grid gap-3">
          {!user ? (
            <>
              <Link href="/signup" className="block text-center rounded-full bg-green-700 text-cream-50 font-bold px-6 py-3 hover:bg-green-800">
                Join PinPals to play — it&apos;s free
              </Link>
              <Link href={`/login?next=${next}`} className="block text-center rounded-full border border-line bg-surface text-navy-900 font-bold px-6 py-3">
                I&apos;m on PinPals — log in
              </Link>
            </>
          ) : mineToHost ? (
            <p className="text-center text-sm text-ink-500">This is your round. Send this link to anyone you&apos;d like to fill it.</p>
          ) : canAsk ? (
            <InterestButton inviteId={t.inviteId} initialStatus={status} />
          ) : (
            <p className="text-center text-sm text-ink-500">This round isn&apos;t available to you.</p>
          )}
          <p className="text-center text-xs text-ink-500">Got the PinPals app? This link opens the round there.</p>
        </div>
      </div>
    </div>
  );
}
