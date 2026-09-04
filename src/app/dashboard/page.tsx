import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { ConnectionProfile, ConnectionWithProfiles, InterestWithDetails, MyTeeTimeRequest, Profile, TeeTimeInvite } from "@/lib/types";
import { initials } from "@/lib/format";
import { profileCompletion } from "@/lib/profile";
import MyAvailability from "./my-availability";
import InterestedGolfers from "./interested-golfers";
import MyTeeTimeRequests from "./my-tee-time-requests";
import ConnectionRequests from "./connection-requests";
import ConnectionList from "./connection-list";

type QuickLink = {
  href: string;
  label: string;
  description: string;
  icon: ReactNode;
  soon?: boolean;
};

const QUICK_LINKS: QuickLink[] = [
  {
    href: "/dashboard/availability/new",
    label: "Post my availability",
    description: "Let other members know when you're free for a round.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-5 h-5">
        <rect x="3.5" y="5" width="17" height="15" rx="2.5" />
        <path d="M3.5 9.5h17" />
        <path d="M8 3v4M16 3v4" />
        <path d="M12 13v4.5M9.75 15.25h4.5" />
      </svg>
    ),
  },
  {
    href: "/community",
    label: "Find golfers",
    description: "Browse members by club, county and handicap.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-5 h-5">
        <circle cx="9" cy="8" r="3.2" />
        <path d="M3.5 19c0-3 2.5-5 5.5-5s5.5 2 5.5 5" />
        <circle cx="17" cy="8.5" r="2.4" />
        <path d="M15.2 14.3c2.6.2 4.8 2.1 4.8 4.7" />
      </svg>
    ),
  },
  {
    href: "/dashboard/connections",
    label: "My connections",
    description: "See all the golfers in your Pinpals network.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-5 h-5">
        <path d="M8.5 12.5l2 2 5-5" />
        <circle cx="8" cy="8" r="3" />
        <path d="M2.5 19c0-3 2.4-5 5.5-5 1.2 0 2.3.3 3.2.8" />
        <circle cx="17" cy="8" r="2.5" />
        <path d="M15 14.5c2.8.1 5 1.9 5 4.5" />
      </svg>
    ),
  },
  {
    href: "/conversations",
    label: "Messages",
    description: "Chat with golfers you're connected with, or mid-deal with.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-5 h-5">
        <path d="M4 5.5h16v10a1.5 1.5 0 01-1.5 1.5H9l-4 3.5V17H5.5A1.5 1.5 0 014 15.5v-10z" />
        <path d="M8 10h8M8 13h5" />
      </svg>
    ),
  },
  {
    href: "/tee-times",
    label: "Browse tee-time invites",
    description: "See open tee times other Pinpals members have posted.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-5 h-5">
        <circle cx="12" cy="12" r="8.5" />
        <path d="M12 7.5V12l3 2" />
      </svg>
    ),
  },
  {
    href: "/courses",
    label: "Browse courses",
    description: "All 373 Irish clubs, ready to set as your home club.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-5 h-5">
        <line x1="6" y1="20" x2="6" y2="4" />
        <path d="M6 4l11 4-11 4" />
      </svg>
    ),
  },
  {
    href: "/marketplace",
    label: "Marketplace",
    description: "Buy and sell clubs and gear with other members.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-5 h-5">
        <path d="M4 10l1.4-5.2A1.5 1.5 0 016.85 3.7h10.3a1.5 1.5 0 011.45 1.1L20 10" />
        <path d="M4 10h16v8.5A1.5 1.5 0 0118.5 20h-13A1.5 1.5 0 014 18.5V10z" />
        <path d="M9 13.5a3 3 0 006 0" />
      </svg>
    ),
  },
  {
    href: "/dashboard/payouts",
    label: "Get paid for sales",
    description: "Set up (or check) your Stripe payout account.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-5 h-5">
        <rect x="3.5" y="6" width="17" height="12" rx="2" />
        <path d="M3.5 10h17" />
        <path d="M6.5 14.5h4" />
      </svg>
    ),
  },
  {
    href: "/dashboard/orders",
    label: "Your orders",
    description: "Everything you've bought or sold, and any payment still due.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-5 h-5">
        <path d="M6 3.5h12v17l-3-2-3 2-3-2-3 2v-17z" />
        <path d="M9 8.5h6M9 12h6M9 15.5h3.5" />
      </svg>
    ),
  },
];

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ posted?: string }>;
}) {
  const { posted } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single<Profile>();

  const { data: myInvites } = await supabase
    .from("tee_time_invites")
    .select("*")
    .eq("member_id", user.id)
    .in("status", ["open", "full"])
    .gt("expires_at", new Date().toISOString())
    .order("play_date", { ascending: true })
    .returns<TeeTimeInvite[]>();

  // Interest requests on invites this member hosts — RLS already scopes this
  // to their own invites, but the !inner join lets us filter on it directly.
  const { data: interests } = await supabase
    .from("tee_time_interests")
    .select(
      "*, profiles(first_name, home_club, handicap, handicap_visible, avatar_color), tee_time_invites!inner(id, club_name, play_date, member_id)"
    )
    .eq("tee_time_invites.member_id", user.id)
    .order("created_at", { ascending: false })
    .returns<InterestWithDetails[]>();

  const { data: myTeeTimeRequests } = await supabase
    .from("tee_time_interests")
    .select(
      "*, tee_time_invites(id, club_name, play_date, time_from, time_to, exact_tee_time, has_tee_time_booked, status)"
    )
    .eq("member_id", user.id)
    .in("status", ["pending", "accepted", "confirmed"])
    .order("created_at", { ascending: false })
    .returns<MyTeeTimeRequest[]>();

  const { data: connectionRows } = await supabase
    .from("connections")
    .select("*, requester:profiles!connections_requester_id_fkey(*), recipient:profiles!connections_recipient_id_fkey(*)")
    .or(`requester_id.eq.${user.id},recipient_id.eq.${user.id}`)
    .order("created_at", { ascending: false })
    .returns<ConnectionWithProfiles[]>();

  const incomingConnections = (connectionRows ?? []).filter(
    (connection) => connection.recipient_id === user.id && connection.status === "pending"
  );
  const connectedPeople = (connectionRows ?? [])
    .filter((connection) => connection.status === "accepted")
    .map((connection) => connection.requester_id === user.id ? connection.recipient : connection.requester)
    .filter((person): person is ConnectionProfile => person !== null);

  const pendingInterestCount = (interests ?? []).filter((i) => i.status === "pending").length;

  const name = profile ? `${profile.first_name} ${profile.last_name}` : "Golfer";
  const firstName = profile?.first_name ?? "Golfer";
  const completion = profileCompletion(profile);

  return (
    <div className="max-w-5xl mx-auto px-6 py-10 md:py-14">
      <span className="inline-flex items-center gap-2 text-xs font-bold tracking-widest uppercase text-green-700">
        <span className="w-5 h-0.5 bg-gold-500 inline-block" /> Your Pinpals home
      </span>
      <h1 className="font-display font-bold text-3xl md:text-4xl mt-2 mb-8">
        Welcome back, {firstName}.
      </h1>

      {posted && (
        <div className="mb-6 bg-green-100 text-green-800 rounded-xl px-4 py-3 text-sm font-semibold">
          Your availability has been posted — other members will see it in tee-time invites.
        </div>
      )}

      <div className="grid md:grid-cols-[300px_1fr] gap-6 items-start">
        {/* Profile summary */}
        <div className="bg-surface rounded-2xl shadow-lg p-6 text-center">
          <div
            className="w-16 h-16 rounded-full mx-auto mb-3.5 flex items-center justify-center text-white font-display font-bold text-xl"
            style={{ background: profile?.avatar_color ?? "#1f5c2e" }}
          >
            {initials(name)}
          </div>
          <h2 className="font-display font-bold text-lg">{name}</h2>
          <p className="text-sm text-ink-500 mt-0.5 break-all">{user.email}</p>

          <div className="flex flex-wrap justify-center gap-2 mt-3.5">
            {profile?.home_club && (
              <span className="bg-cream-100 text-ink-900 text-xs font-bold px-2.5 py-1 rounded-full">
                {profile.home_club}
              </span>
            )}
            {profile?.county && (
              <span className="bg-cream-100 text-ink-900 text-xs font-bold px-2.5 py-1 rounded-full">
                {profile.county}
              </span>
            )}
            {profile?.handicap != null && (
              <span className="bg-red-100 text-red-600 text-xs font-bold px-2.5 py-1 rounded-full">
                {profile.handicap} hcp
              </span>
            )}
          </div>

          {profile?.gui_membership_number && (
            <p className="text-xs text-ink-500 mt-3">
              GUI / Golf Ireland No. {profile.gui_membership_number}
            </p>
          )}

          {!profile?.home_club && (
            <p className="text-xs text-ink-500 mt-3.5">
              Add your home club so other golfers can find you.
            </p>
          )}

          <div className="mt-5 text-left">
            <div className="flex items-center justify-between text-xs font-bold text-ink-500 mb-1.5">
              <span>Profile complete</span>
              <span className="text-green-700">{completion}%</span>
            </div>
            <div className="h-2 rounded-full bg-cream-100 overflow-hidden">
              <div
                className="h-full rounded-full bg-green-600"
                style={{ width: `${completion}%` }}
              />
            </div>
          </div>

          <Link
            href="/profile/edit"
            className="inline-block mt-5 px-5 py-2.5 rounded-full font-bold text-sm bg-green-700 text-cream-50 hover:bg-green-600 transition"
          >
            Edit profile
          </Link>
          <Link
            href="/profile"
            className="block mt-2.5 text-sm font-semibold text-ink-500 hover:text-green-700 transition"
          >
            View full profile
          </Link>
        </div>

        {/* Quick actions */}
        <div>
          <h2 className="font-display font-bold text-xl mb-4">What would you like to do?</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {QUICK_LINKS.map((q) =>
              q.soon ? (
                <div
                  key={q.label}
                  aria-disabled="true"
                  className="relative bg-surface border border-line rounded-2xl p-6 shadow-sm opacity-60 cursor-not-allowed"
                >
                  <span className="absolute top-4 right-4 bg-cream-100 text-ink-500 text-[10.5px] font-bold uppercase tracking-wide px-2 py-1 rounded-full">
                    Coming soon
                  </span>
                  <div className="w-10 h-10 rounded-full bg-cream-100 text-ink-500 flex items-center justify-center mb-3.5">
                    {q.icon}
                  </div>
                  <h3 className="font-display font-bold text-lg">{q.label}</h3>
                  <p className="text-sm text-ink-500 mt-1">{q.description}</p>
                </div>
              ) : (
                <Link
                  key={q.label}
                  href={q.href}
                  className="group bg-surface border border-line rounded-2xl p-6 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition"
                >
                  <div className="w-10 h-10 rounded-full bg-green-100 text-green-700 flex items-center justify-center mb-3.5">
                    {q.icon}
                  </div>
                  <h3 className="font-display font-bold text-lg">{q.label}</h3>
                  <p className="text-sm text-ink-500 mt-1">{q.description}</p>
                  <span className="inline-block mt-3.5 text-sm font-bold text-green-700 group-hover:text-green-600">
                    Go &rarr;
                  </span>
                </Link>
              )
            )}
          </div>
        </div>
      </div>

      <div className="mt-12 pt-10 border-t border-line">
        <div className="flex items-center gap-2.5 mb-4 flex-wrap">
          <h2 className="font-display font-bold text-xl">Connection requests</h2>
          {incomingConnections.length > 0 && (
            <span className="bg-gold-500 text-navy-900 text-xs font-bold px-2.5 py-1 rounded-full">
              {incomingConnections.length} waiting on you
            </span>
          )}
        </div>
        <ConnectionRequests requests={incomingConnections} />
      </div>

      <div className="mt-12 pt-10 border-t border-line">
        <div className="flex items-center justify-between gap-4 mb-4">
          <div>
            <h2 className="font-display font-bold text-xl">Your connections</h2>
            <p className="text-sm text-ink-500 mt-1">Golfers you have connected with.</p>
          </div>
          <Link href="/dashboard/connections" className="shrink-0 text-sm font-bold text-green-700 hover:text-green-600">
            View all &rarr;
          </Link>
        </div>
        <ConnectionList people={connectedPeople.slice(0, 6)} compact />
      </div>

      <div className="mt-12 pt-10 border-t border-line">
        <h2 className="font-display font-bold text-xl mb-4">Your tee-time requests</h2>
        <MyTeeTimeRequests requests={myTeeTimeRequests ?? []} />
      </div>

      <div className="mt-12 pt-10 border-t border-line">
        <MyAvailability invites={myInvites ?? []} />
      </div>

      <div className="mt-12 pt-10 border-t border-line">
        <div className="flex items-center gap-2.5 mb-4 flex-wrap">
          <h2 className="font-display font-bold text-xl">Interested golfers</h2>
          {pendingInterestCount > 0 && (
            <span className="bg-gold-500 text-navy-900 text-xs font-bold px-2.5 py-1 rounded-full">
              {pendingInterestCount} waiting on you
            </span>
          )}
        </div>
        <InterestedGolfers interests={interests ?? []} />
      </div>
    </div>
  );
}

