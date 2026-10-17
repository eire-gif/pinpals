import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

import { isEmailInviteToken } from "@/lib/group-invites";
import { createClient } from "@/lib/supabase/server";
import JoinSocietyForm from "./join-society-form";

export const metadata = { title: "You're invited to a society on PinPals", robots: { index: false, follow: false } };

type Preview = {
  group_id: number;
  name: string;
  about: string | null;
  member_count: number;
  club_name: string | null;
  owner_first_name: string | null;
  logo_url: string | null;
  email: string;
  first_name: string | null;
  status: "pending" | "joined" | "cancelled";
};

/**
 * /join/s/<token> — the button in a society's emailed invitation (0170),
 * sent when the secretary imported the member list. Same front page as a
 * group's invite link (/join/g), addressed to the person it was sent to.
 * With the app installed the link opens the app instead (AASA: /join/*).
 */
export default async function JoinSocietyPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!isEmailInviteToken(token)) notFound();

  const supabase = await createClient();
  const [{ data: rows }, { data: auth }] = await Promise.all([supabase.rpc("group_email_invite_preview", { p_token: token }), supabase.auth.getUser()]);
  const invite = (rows as Preview[] | null)?.[0];
  if (!invite) notFound();
  const people = invite.member_count === 1 ? "1 member" : `${invite.member_count} members`;

  return (
    <div className="relative min-h-[80vh] flex items-center justify-center px-6 py-16 overflow-hidden">
      <Image src="/images/homepage-hero.jpg" alt="" fill priority sizes="100vw" className="object-cover" />
      <div className="absolute inset-0 bg-navy-900/70" />
      <div className="relative w-full max-w-md bg-surface rounded-3xl p-8 shadow-[0_12px_40px_rgba(12,32,56,0.35)] text-center">
        {invite.logo_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={invite.logo_url} alt="" width={72} height={72} className="mx-auto mb-4 h-[72px] w-[72px] rounded-2xl object-cover" />
        ) : null}
        <p className="text-xs font-bold tracking-widest uppercase text-gold-600">{invite.first_name ? `${invite.first_name}, you're invited` : "You're invited"}</p>
        <h1 className="font-display font-bold text-3xl text-navy-900 mt-1">{invite.name}</h1>
        <p className="text-ink-500 mt-1">
          Society · {people}
          {invite.club_name ? ` · ${invite.club_name}` : ""}
        </p>
        {invite.about ? <p className="text-ink-900 mt-4 whitespace-pre-line">{invite.about}</p> : null}
        {invite.owner_first_name ? <p className="text-sm text-ink-500 mt-4">Run by {invite.owner_first_name}</p> : null}

        {invite.status === "cancelled" ? (
          <p className="mt-6 text-ink-900">This invitation has been withdrawn. Ask the society&rsquo;s secretary for a new one.</p>
        ) : invite.status === "joined" ? (
          <div className="mt-6 grid gap-2">
            <p className="text-ink-900">This invitation has been used — you&rsquo;re in the society.</p>
            <Link href={auth.user ? `/groups/${invite.group_id}` : "/login"} className="font-bold text-green-700">
              {auth.user ? "Open the society →" : "Log in to PinPals →"}
            </Link>
          </div>
        ) : (
          <>
            <ul className="text-left text-sm text-ink-900 grid gap-2 my-6">
              <li>✓ The society&rsquo;s events, entries and the draw in one place</li>
              <li>✓ Live scoring and a leaderboard everyone can follow</li>
              <li>✓ Results and the order of merit, kept for every outing</li>
            </ul>
            <JoinSocietyForm token={token} email={invite.email} groupName={invite.name} signedIn={!!auth.user} />
            {!auth.user ? <p className="text-xs text-ink-500 mt-3">Sent to {invite.email}</p> : null}
          </>
        )}
      </div>
    </div>
  );
}
