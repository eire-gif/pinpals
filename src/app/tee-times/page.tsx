import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import type { MyInterest, TeeTimeInviteWithHost } from "@/lib/types";
import RegionSelect from "@/components/region-select";
import {
  SPACES_OPTIONS,
  VISIBILITY_BADGES,
  formatInviteDate,
  formatTimeRange,
  formatClock,
} from "@/lib/tee-times";
import { initials } from "@/lib/format";
import { formatDistance, parseCoords, parseRadiusKm } from "@/lib/geo";
import InterestButton from "./interest-button";
import NearbySearch from "./nearby-search";

export default async function TeeTimesPage({
  searchParams,
}: {
  searchParams: Promise<{
    county?: string;
    club?: string;
    date?: string;
    spaces?: string;
    lat?: string;
    lng?: string;
    radius?: string;
  }>;
}) {
  const { county = "", club = "", date = "", spaces = "", lat, lng, radius } = await searchParams;
  // Validated rather than trusted: these three come from a URL anyone can
  // edit by hand. Anything that isn't a real coordinate reads as "no location
  // search", which is the same as not having pressed the button.
  const coords = parseCoords(lat, lng);
  const radiusKm = parseRadiusKm(radius);
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

  // Proximity first, as a separate call, so the main query below keeps its
  // shape (including the host join) instead of being duplicated inside a
  // database function that would then have to be kept in step with it.
  //
  // invites_near() is SECURITY INVOKER, so a "connections only" invite stays
  // invisible to anyone outside the host's connections here exactly as it is
  // everywhere else — the proximity search cannot be used to discover one.
  let nearbyDistanceById: Map<number, number> | null = null;
  if (coords) {
    const { data, error: nearbyError } = await supabase.rpc("invites_near", {
      p_lat: coords.lat,
      p_lng: coords.lng,
      p_radius_km: radiusKm,
    });

    if (nearbyError) {
      console.error("[tee-times] Nearby search failed:", nearbyError.message);
    }
    // Cast rather than .returns<T>(): the checked-in Supabase types were
    // generated before this function existed, so the client can't infer its
    // row shape. The shape is fixed by 0068's `returns table (...)`.
    const nearby = (data ?? []) as { invite_id: number; distance_km: number }[];
    // An empty result is a real answer ("nothing within 30 km"), not a
    // missing filter — so this map is set even when it has no entries, and
    // the query below correctly returns nothing.
    nearbyDistanceById = new Map(nearby.map((row) => [row.invite_id, row.distance_km]));
  }

  let query = supabase
    .from("tee_time_invites")
    .select("*, profiles(first_name, last_name, home_club, avatar_color, handicap, handicap_visible)")
    .eq("status", "open")
    .gt("expires_at", new Date().toISOString());

  if (nearbyDistanceById) query = query.in("id", [...nearbyDistanceById.keys()]);
  if (county) query = query.eq("county", county);
  if (club) query = query.ilike("club_name", `%${club}%`);
  if (date) query = query.eq("play_date", date);
  if (spaces) query = query.gte("spaces_available", Number(spaces));

  const { data: rawInvites } = await query
    .order("play_date", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(60)
    .returns<TeeTimeInviteWithHost[]>();

  // Nearest first when a location search is on — "near me" that returned
  // results in date order would bury the course down the road under one three
  // counties away. Date order is restored the moment the location is cleared.
  const invites = nearbyDistanceById
    ? [...(rawInvites ?? [])].sort(
        (a, b) =>
          (nearbyDistanceById.get(a.id) ?? Infinity) - (nearbyDistanceById.get(b.id) ?? Infinity)
      )
    : rawInvites;

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
  const hasFilters = Boolean(county || club || date || spaces || coords);

  return (
    <div>
      {header}
      <div className="max-w-6xl mx-auto px-6 py-14">
        <form className="flex flex-wrap gap-3.5 items-center justify-between bg-surface border border-line rounded-2xl px-5 py-4 shadow-sm mb-8">
          <div className="relative flex-1 min-w-[200px]">
            <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            {/* Plain text search, no autocomplete list. This used to render
                a <datalist> of all 373 Irish club names; the directory is now
                ~3,000 clubs across five countries, which is far too much to
                ship on every page load to populate a filter that already
                matches on a partial name. */}
            <input
              type="text"
              name="club"
              defaultValue={club}
              placeholder="Search by golf club…"
              className="w-full pl-10 pr-3.5 py-2.5 rounded-full border-[1.5px] border-line bg-surface-tint text-sm"
            />
          </div>
          <RegionSelect
            name="county"
            defaultValue={county}
            ariaLabel="County"
            className="px-3.5 py-2.5 rounded-full border-[1.5px] border-line bg-surface-tint text-sm font-semibold"
          />
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

          {/* Inside the same card as the other filters, on its own row: it
              needs a permission prompt and can fail in ways a <select>
              can't, so it gets space for a message rather than being
              squeezed in beside them. It sits outside the form's submit
              flow — it navigates by itself, carrying the other filters. */}
          <div className="w-full border-t border-line pt-3.5 mt-0.5">
            <NearbySearch activeRadiusKm={coords ? radiusKm : null} />
          </div>
        </form>

        {coords && (
          <p className="text-sm text-ink-500 mb-6 -mt-4">
            Showing open invites within{" "}
            <span className="font-bold text-ink-900">{radiusKm} km</span> of you, nearest first.
            {/* Said plainly rather than hidden: 109 of the ~2,655 clubs in the
                directory have no coordinates from the OSM import, and an
                invite at one of them cannot appear in a distance search at
                all. A member who knows a round exists and can't see it here
                deserves to know why. */}{" "}
            Clubs without a location on file won&rsquo;t appear here — search by county to see those.
          </p>
        )}

        {!invites || invites.length === 0 ? (
          <div className="text-center py-16 text-ink-500">
            {coords
              ? `No open invites within ${radiusKm} km of you — try a wider radius, or post your own availability.`
              : hasFilters
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
                  {nearbyDistanceById?.has(invite.id) && (
                    <p className="text-xs font-bold text-green-700 mt-1 inline-flex items-center gap-1">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                        <path d="M12 21s7-6.2 7-11a7 7 0 10-14 0c0 4.8 7 11 7 11z" strokeLinecap="round" strokeLinejoin="round" />
                        <circle cx="12" cy="10" r="2.6" />
                      </svg>
                      {formatDistance(nearbyDistanceById.get(invite.id) as number)}
                    </p>
                  )}
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
                    {/* A card reaching this list is one the read policy
                        already let through, so this badge never gates
                        anything — it tells the viewer why a round they can
                        see isn't on every other member's screen, and tells
                        the host their own post went where they meant it. */}
                    {VISIBILITY_BADGES[invite.visibility] && (
                      <span className="bg-navy-900 text-cream-50 text-xs font-bold px-2.5 py-1 rounded-full">
                        {VISIBILITY_BADGES[invite.visibility]}
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

    </div>
  );
}
