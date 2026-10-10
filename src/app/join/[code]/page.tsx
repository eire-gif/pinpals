import Image from "next/image";
import { notFound } from "next/navigation";

import MemberAvatar from "@/components/member-avatar";
import { isInviteCode } from "@/lib/find-pinpals";
import { createClient } from "@/lib/supabase/server";
import JoinForm from "./join-form";

export const metadata = { title: "You're invited to PinPals" };

/**
 * /join/<code> — a member's invite link, and where their QR code lands.
 * Shows who invited you (first name and club only) and connects you with
 * them, now if you're signed in, otherwise as soon as you are.
 */
export default async function JoinPage({ params }: { params: Promise<{ code: string }> }) {
  const { code: raw } = await params;
  const code = raw.toLowerCase();
  if (!isInviteCode(code)) notFound();

  const supabase = await createClient();
  const [{ data: rows }, { data: auth }] = await Promise.all([
    supabase.rpc("invite_preview", { p_code: code }),
    supabase.auth.getUser(),
  ]);
  const inviter = (rows as { first_name: string | null; last_initial: string; home_club: string | null; avatar_url: string | null; avatar_color: string | null }[] | null)?.[0];
  if (!inviter) notFound();
  const firstName = inviter.first_name || "A golfer";

  return (
    <div className="relative min-h-[80vh] flex items-center justify-center px-6 py-16 overflow-hidden">
      <Image src="/images/homepage-hero.jpg" alt="" fill priority sizes="100vw" className="object-cover" />
      <div className="absolute inset-0 bg-navy-900/70" />
      <div className="relative w-full max-w-md bg-surface rounded-3xl p-8 shadow-[0_12px_40px_rgba(12,32,56,0.35)] text-center">
        <div className="flex justify-center">
          <MemberAvatar name={`${firstName} ${inviter.last_initial}`} avatarUrl={inviter.avatar_url} color={inviter.avatar_color} size="lg" />
        </div>
        <p className="mt-4 text-xs font-bold tracking-widest uppercase text-gold-600">You&rsquo;re invited</p>
        <h1 className="font-display font-bold text-3xl text-navy-900 mt-1">
          {firstName} {inviter.last_initial ? `${inviter.last_initial}.` : ""} wants you on PinPals
        </h1>
        {inviter.home_club ? <p className="text-ink-500 mt-1">{inviter.home_club}</p> : null}
        <ul className="text-left text-sm text-ink-900 grid gap-2 my-6">
          <li>✓ Find a game — members share spare places in their fourballs</li>
          <li>✓ Live scoring for your rounds, scrambles and match days</li>
          <li>✓ Buy and sell golf gear, with Buyer Protection</li>
        </ul>
        <JoinForm code={code} firstName={firstName} signedIn={!!auth.user} />
      </div>
    </div>
  );
}
