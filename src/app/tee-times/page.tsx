import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import type { MyInterest, TeeTimeInviteWithHost } from "@/lib/types";
import { CLUBS, COUNTIES } from "@/lib/clubs";
import { SPACES_OPTIONS, formatInviteDate, formatTimeRange, formatClock } from "@/lib/tee-times";
import { initials } from "@/lib/format";
import InterestButton from "./interest-button";

export default async function TeeTimesPage({
  searchParams,
}: {
  searchParams: Promise<{ county?: string; club?: string; date?: string; spaces?: string }>;
}) {
  const { county = "", club = "", date = "", spaces = "" } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const header = (
    <div className="relative bg-navy-900 text-white pt-16 pb-14 overflow-hidden">
      <div className="max-w-6xl mx-auto px-6">
        <span className="inline-flex items-center gap-2 text-xs font-bold tracking-widest uppercase text-gold-500">
          <span className="w-5 h-0.5 bg-gold-500 inline-block" /> Tee-time invites
        </span>
        <h1 className="font-display font-bold text-4xl mt-2.5">Find a game this week.</h1>
        <p className="text-white/80 mt-3 max-w-[52ch]">
          Browse open availability posted by other Pinpals members and join them for a round.
        </p>
        {user && (
          <Link
            href="/dashboard/availability/new"
            className="inline-block mt-6 px-6 py-3 rounded-full font-bold bg-green-700 text-cream-50 hover:bg-green-600 transition"
          >
            Post your availability
          </Link>
        )}
      </div>
    </div>
  );

  if (!user) {
    return (
      <div>
        {header}
        <div className="max-w-6xl mx-auto px-6 py-16 text-center">
          <div className="bg-surface rounded-2xl shadow-lg p-10 max-w-md mx-auto">
            <h2 className="font-display font-bold text-2xl mb-2">Join to see open invites.</h2>
            <p className="text-ink-500 mb-6">
              Create a free profile to browse tee-time invites from other members and post your own.
            </p>
            <Link href="/signup" className="inline-block px-6 py-3 rounded-full font-bold bg-green-700 text-cream-50 hover:bg-green-600 transition">
              Join Pinpals
            </Link>
          </div>
        </div>
      </div>
    );
  }

  let query = supabase
    .from("tee_time_invites")
    .select("*, profiles(first_name, last_name, home_club, avatar_color, handicap, handicap_visible)")
    .eq("status", "open")
    .gt("expires_at", new Date().toISOString());

  if (county) query = query.eq("county", county);
  if (club) query = query.ilike("club_name", `%${club}%`);
  if (date) query = query.eq("play_date", date);
  if (spaces) query = query.gte("spaces_available", Number(spaces));

  const { data: invites } = await query
    .order("play_date", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(60)
    .returns<TeeTimeInviteWithHost[]>();

  // So each card can swap its "I'm interested" button for the outcome if the
  // current member has already sent (or heard back on) a request.
  const inviteIds = (invites ?? []).map((i) => i.id);
  let myInterests: MyInterest[] = [];
  if (inviteIds.length > 0) {
    const { data } = await supabase
      .from("tee_time_interests")
      .select("invite_id, status")
      .eq("member_id", user.id)
      .in("invite_id", inviteIds)
      .returns<MyInterest[]>();
    myInterests = data ?? [];
  }
  const myInterestByInvite = new Map(myInterests.map((i) => [i.invite_id, i.status]));

  const today = new Date().toISOString().slice(0, 10);
  const hasFilters = Boolean(county || club || date || spaces);

  return (
    <div>
      {header}
      <div className="max-w-6xl mx-auto px-6 py-14">
        <form className="flex flex-wrap gap-3.5 items-center justify-between bg-surface border border-line rounded-2xl px-5 py-4 shadow-sm mb-8">
          <div className="relative flex-1 min-w-[200px]">
            <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              name="club"
              list="club-options"
              defaultValue={club}
              placeholder="Search by golf club…"
              className="w-full pl-10 pr-3.5 py-2.5 rounded-full border-[1.5px] border-line bg-surface-tint text-sm"
            />
          </div>
          <select name="county" defaultValue={county} className="px-3.5 py-2.5 rounded-full border-[1.5px] border-line bg-surface-tint text-sm font-semibold">
            <option value="">All counties</option>
            {COUNTIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <input
            type="date"
            name="date"
            defaultValue={date}
            min={today}
            className="px-3.5 py-2.5 rounded-full border-[1.5px] border-line bg-surface-tint text-sm font-semibold"
          />
          <select name="spaces" defaultValue={spaces} className="px-3.5 py-2.5 rounded-full border-[1.5px] border-line bg-surface-tint text-sm font-semibold">
            <option value="">Any spaces</option>
            {SPACES_OPTIONS.map((n) => (
              <option key={n} value={n}>{n}+ {n === 1 ? "space" : "spaces"}</option>
            ))}
          </select>
          <button type="submit" className="px-5 py-2.5 rounded-full font-bold bg-green-700 text-cream-50 text-sm">
            Filter
          </button>
          {hasFilters && (
            <Link href="/tee-times" className="text-sm font-semibold text-ink-500 hover:text-green-700 transition">
              Clear filters
            </Link>
          )}
        </form>

        {!invites || invites.length === 0 ? (
          <div className="text-center py-16 text-ink-500">
            {hasFilters
              ? "No open invites match those filters — try widening your search."
              : "No open invites right now — be the first to post your availability."}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {invites.map((invite) => {
              const host = invite.profiles;
              const hostFirstName = host?.first_name ?? "A Pinpals member";
              const avatarInitials = initials(host ? `${host.first_name} ${host.last_name}` : "PP");
              const timeRange = formatTimeRange(invite.time_from, invite.time_to);
              const exactTime = formatClock(invite.exact_tee_time);
              const isMe = invite.member_id === user.id;
              const myStatus = myInterestByInvite.get(invite.id);

              return (
                <div key={invite.id} className="bg-surface border border-line rounded-2xl p-6 shadow-sm flex flex-col">
                  <span className="text-[11.5px] uppercase tracking-wider text-green-700 font-bold">
                    {formatInviteDate(invite.play_date)}
                  </span>
                  <h3 className="font-display font-bold text-lg mt-1.5">{invite.club_name}</h3>
                  {invite.county && <p className="text-xs text-ink-500 mt-0.5">{invite.county}</p>}

                  <div className="flex flex-wrap gap-2 mt-3">
                    <span className="bg-cream-100 text-xs font-bold px-2.5 py-1 rounded-full">
                      {invite.spaces_available} {invite.spaces_available === 1 ? "space" : "spaces"}
                    </span>
                    {timeRange && (
                      <span className="bg-cream-100 text-xs font-bold px-2.5 py-1 rounded-full">
                        {timeRange}
                      </span>
                    )}
                    {exactTime && (
                      <span className="bg-cream-100 text-xs font-bold px-2.5 py-1 rounded-full">
                        Tee time {exactTime}
                      </span>
                    )}
                    {invite.handicap_limit != null && (
                      <span className="bg-cream-100 text-xs font-bold px-2.5 py-1 rounded-full">
                        Up to {invite.handicap_limit} hcp
                      </span>
                    )}
                  </div>

                  {invite.notes && (
                    <p className="text-sm text-ink-700 mt-3.5 line-clamp-3">{invite.notes}</p>
                  )}

                  <div className="flex items-center gap-2.5 mt-5 pt-4 border-t border-line">
                    <div
                      className="w-8 h-8 rounded-full flex items-center justify-center text-white font-display font-bold text-xs shrink-0"
                      style={{ background: host?.avatar_color ?? "#1f5c2e" }}
                    >
                      {avatarInitials}
                    </div>
                    <div className="text-sm">
                      <span className="font-semibold">{isMe ? "You" : hostFirstName}</span>
                      {host?.home_club && <span className="text-ink-500"> · {host.home_club}</span>}
                      {host?.handicap_visible && host.handicap != null && (
                        <span className="text-ink-500"> · {host.handicap} hcp</span>
                      )}
                    </div>
                  </div>

                  <div className="mt-4">
                    {isMe ? (
                      <Link
                        href="/dashboard"
                        className="block w-full text-center py-2.5 rounded-full font-bold text-sm border-[1.5px] border-green-700 text-green-700 hover:bg-green-100 transition"
                      >
                        Manage on dashboard
                      </Link>
                    ) : (
                      <InterestButton inviteId={invite.id} initialStatus={myStatus} />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Native browser autocomplete for the club filter above — no client
          JS needed, keeps this page a plain server-rendered form like the
          rest of the site's search/filter bars. */}
      <datalist id="club-options">
        {CLUBS.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
    </div>
  );
}
