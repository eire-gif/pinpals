import Image from "next/image";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import type { Connection, Profile } from "@/lib/types";
import { COUNTRIES, isCountryCode } from "@/lib/regions";
import RegionSelect from "@/components/region-select";
import MemberCard from "@/components/member-card";
import { parseScope } from "@/lib/community";
import ScopeSelector from "./scope-selector";

export default async function CommunityPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    country?: string;
    county?: string;
    sort?: string;
    scope?: string;
  }>;
}) {
  const { q = "", country = "", county = "", sort = "recent", scope: scopeParam } = await searchParams;
  const scope = parseScope(scopeParam);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const header = (
    <div className="relative bg-navy-900 text-white pt-16 pb-14 overflow-hidden">
      <Image
        src="/images/community-header.jpg"
        alt="Golfers walking a fairway together"
        fill
        className="object-cover -z-10 opacity-40"
      />
      <div className="absolute inset-0 bg-gradient-to-b from-[rgba(9,22,40,0.55)] to-[rgba(9,22,40,0.92)] -z-10" />
      {/* Heading left, call to action right and vertically centred against
          it on desktop; stacked on mobile, where a button sitting beside a
          four-line heading would be squeezed to nothing. */}
      <div className="max-w-6xl mx-auto px-6 flex flex-col md:flex-row md:items-center md:justify-between gap-7">
        <div>
          <span className="inline-flex items-center gap-2 text-xs font-bold tracking-widest uppercase text-gold-500">
            <span className="w-5 h-0.5 bg-gold-500 inline-block" /> Community
          </span>
          <h1 className="font-display font-bold text-4xl mt-2.5">Find golfers near you.</h1>
          <p className="text-white/80 mt-3 max-w-[52ch]">
            Search by name, home club, country or county to find your next playing partner.
          </p>
        </div>
        {/* Signed-in only, exactly as the same CTA on /tee-times is: a
            logged-out visitor sees "Join to see the directory" below this
            header, and offering them an action that bounces straight to
            /login would undercut it. */}
        {user && (
          <Link
            href="/dashboard/availability/new"
            className="shrink-0 self-start md:self-auto inline-block px-6 py-3 rounded-full font-bold bg-green-700 text-cream-50 hover:bg-green-600 transition whitespace-nowrap"
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
            <h2 className="font-display font-bold text-2xl mb-2">Join to see the directory.</h2>
            <p className="text-ink-500 mb-6">
              Create a free profile to browse golfers by club, county and handicap.
            </p>
            <Link href="/signup" className="inline-block px-6 py-3 rounded-full font-bold bg-green-700 text-cream-50 hover:bg-green-600 transition">
              Join Pinpals
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Both reads happen before the directory query because the two scopes
  // below narrow it: "my club" needs this member's own club, "my
  // connections" needs the ids. Neither depends on the other, so they go in
  // parallel.
  const [{ data: me }, { data: connections }] = await Promise.all([
    supabase
      .from("profiles")
      .select("home_club, home_club_id")
      .eq("id", user.id)
      .maybeSingle<Pick<Profile, "home_club" | "home_club_id">>(),
    supabase
      .from("connections")
      .select("*")
      .or(`requester_id.eq.${user.id},recipient_id.eq.${user.id}`)
      .returns<Connection[]>(),
  ]);

  const connectedMemberIds = (connections ?? [])
    .filter((c) => c.status === "accepted")
    .map((c) => (c.requester_id === user.id ? c.recipient_id : c.requester_id));

  // Why each scope can come up empty for a reason that isn't "no matches":
  // a member who has never set a home club can't have club-mates, and a new
  // member has no connections. Both are worth saying out loud rather than
  // showing the generic "no golfers match that search".
  const hasHomeClub = Boolean(me?.home_club_id || me?.home_club);
  const scopeUnavailable =
    (scope === "club" && !hasHomeClub) || (scope === "connections" && connectedMemberIds.length === 0);

  // Everyone, including members who haven't set a home club yet. This used
  // to filter them out — which meant a real member who skipped that step was
  // invisible to the whole directory, couldn't be found or connected with,
  // and had no way of knowing. For a site whose point is getting golfers
  // talking to each other, silently hiding one is the more expensive of the
  // two mistakes. Their card says "No club set yet" instead (MemberCard),
  // which is honest and still leaves them reachable.
  let query = supabase.from("profiles").select("*");

  if (scope === "club" && hasHomeClub) {
    // Prefer the real reference over the display name: since 0062 two clubs
    // in different countries can share a name, and matching on the string
    // would put a Woodbrook member in a different country's Woodbrook.
    query = me?.home_club_id
      ? query.eq("home_club_id", me.home_club_id)
      : query.eq("home_club", me?.home_club ?? "");
  } else if (scope === "connections") {
    // An empty list would make .in() match nothing, which is the right
    // answer — but scopeUnavailable already catches that case and explains
    // it, so this only runs with real ids.
    query = query.in("id", connectedMemberIds);
  }

  if (q) {
    query = query.or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%,home_club.ilike.%${q}%`);
  }
  if (isCountryCode(country)) {
    query = query.eq("country", country);
  }
  if (county) {
    query = query.eq("county", county);
  }
  if (sort === "name") {
    query = query.order("first_name", { ascending: true });
  } else if (sort === "handicap") {
    query = query.order("handicap", { ascending: true, nullsFirst: false });
  } else {
    query = query.order("created_at", { ascending: false });
  }

  // Skipped entirely when the scope can't return anything — no point asking
  // the database for club-mates of a member with no club.
  const { data: members } = scopeUnavailable
    ? { data: [] as Profile[] }
    : await query.limit(60).returns<Profile[]>();

  // Age bands come from the dedicated view, never from `profiles` — the
  // date of birth behind them is deliberately unreadable by anyone but its
  // owner (see supabase/migrations/0059_member_photos_and_age_bands.sql).
  // A member with no row here has either not set a date or not opted in;
  // both read as "Not shared", which is the point.
  const memberIds = (members ?? []).map((m) => m.id);
  const { data: ageBands } = memberIds.length
    ? await supabase
        .from("member_age_bands")
        .select("user_id, age_band")
        .in("user_id", memberIds)
        .returns<{ user_id: string; age_band: string }[]>()
    : { data: [] as { user_id: string; age_band: string }[] };

  const ageBandByMember = new Map((ageBands ?? []).map((r) => [r.user_id, r.age_band]));

  const connectionByMember = new Map(
    (connections ?? []).map((connection) => [
      connection.requester_id === user.id ? connection.recipient_id : connection.requester_id,
      connection,
    ])
  );

  return (
    <div>
      {header}
      <div className="max-w-6xl mx-auto px-6 py-14">
        <form className="flex flex-wrap gap-3.5 items-center justify-between bg-surface border border-line rounded-2xl px-5 py-4 shadow-sm mb-8">
          <div className="relative flex-1 min-w-[220px]">
            <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input type="text" name="q" defaultValue={q} placeholder="Search by name or home club…"
              className="w-full pl-10 pr-3.5 py-2.5 rounded-full border-[1.5px] border-line bg-surface-tint text-sm" />
          </div>
          {/* Two independent filters. Members can now be anywhere across five
              countries, and a bare 32-county list would have no "Surrey" in
              it at all. The county select carries every country's regions,
              grouped under country headings, so it stays readable at 174
              options. */}
          <select name="country" defaultValue={country} className="px-3.5 py-2.5 rounded-full border-[1.5px] border-line bg-surface-tint text-sm font-semibold">
            <option value="">All countries</option>
            {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
          </select>
          <RegionSelect
            name="county"
            defaultValue={county}
            ariaLabel="County"
            className="px-3.5 py-2.5 rounded-full border-[1.5px] border-line bg-surface-tint text-sm font-semibold"
          />
          <select name="sort" defaultValue={sort} className="px-3.5 py-2.5 rounded-full border-[1.5px] border-line bg-surface-tint text-sm font-semibold">
            <option value="recent">Newest members</option>
            <option value="name">Name A–Z</option>
            <option value="handicap">Lowest handicap</option>
          </select>
          <button type="submit" className="px-5 py-2.5 rounded-full font-bold bg-green-700 text-cream-50 text-sm">
            Search
          </button>

          {/* Its own full-width row under the search controls, in the same
              card. Radios rather than another pill select: this doesn't
              narrow the same list the way country and county do, it changes
              which list you're looking at, and that's worth spelling out
              instead of hiding behind a dropdown label. Modelled on the
              tee-time audience selector.

              Inside the form, so it carries the search box and the three
              selects along with it, and so it still works with JavaScript
              off — see ScopeSelector for why it submits on change. */}
          <ScopeSelector value={scope} />
        </form>

        {!members || members.length === 0 ? (
          <div className="text-center py-16 text-ink-500">
            {/* Three different silences, three different answers. "No
                golfers match" would be misleading for the first two: nothing
                is wrong with the search, the member just hasn't set up the
                thing the scope depends on yet — so each says what to do
                about it. */}
            {scope === "club" && !hasHomeClub ? (
              <>
                Set your home club on{" "}
                <Link href="/profile/edit" className="font-bold text-green-700 hover:underline">
                  your profile
                </Link>{" "}
                to see other members who play there.
              </>
            ) : scope === "connections" && connectedMemberIds.length === 0 ? (
              <>
                You haven&rsquo;t connected with anyone yet — switch to{" "}
                <span className="font-bold text-ink-900">All members</span> above and send a
                request to a golfer you&rsquo;d like a game with.
              </>
            ) : scope === "club" ? (
              <>No other members have {me?.home_club} set as their home club yet.</>
            ) : (
              <>No golfers match that search yet — widen your filters, or check back soon.</>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
            {members.map((m) => (
              <MemberCard
                key={m.id}
                member={m}
                currentUserId={user.id}
                ageBand={ageBandByMember.get(m.id)}
                connection={connectionByMember.get(m.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

