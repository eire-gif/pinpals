import Image from "next/image";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";
import { COUNTIES } from "@/lib/clubs";
import { initials } from "@/lib/format";

export default async function CommunityPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; county?: string; sort?: string }>;
}) {
  const { q = "", county = "", sort = "recent" } = await searchParams;
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
      <div className="max-w-6xl mx-auto px-6">
        <span className="inline-flex items-center gap-2 text-xs font-bold tracking-widest uppercase text-gold-500">
          <span className="w-5 h-0.5 bg-gold-500 inline-block" /> Community
        </span>
        <h1 className="font-display font-bold text-4xl mt-2.5">Find golfers near you.</h1>
        <p className="text-white/80 mt-3 max-w-[52ch]">
          Search by name, home club or county to find your next playing partner.
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

  let query = supabase.from("profiles").select("*").not("home_club", "is", null);

  if (q) {
    query = query.or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%,home_club.ilike.%${q}%`);
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

  const { data: members } = await query.limit(60).returns<Profile[]>();

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
          <select name="county" defaultValue={county} className="px-3.5 py-2.5 rounded-full border-[1.5px] border-line bg-surface-tint text-sm font-semibold">
            <option value="">All counties</option>
            {COUNTIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select name="sort" defaultValue={sort} className="px-3.5 py-2.5 rounded-full border-[1.5px] border-line bg-surface-tint text-sm font-semibold">
            <option value="recent">Newest members</option>
            <option value="name">Name A–Z</option>
            <option value="handicap">Lowest handicap</option>
          </select>
          <button type="submit" className="px-5 py-2.5 rounded-full font-bold bg-green-700 text-cream-50 text-sm">
            Search
          </button>
        </form>

        {!members || members.length === 0 ? (
          <div className="text-center py-16 text-ink-500">
            No golfers match that search yet — widen your filters, or check back soon.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {members.map((m) => {
              const name = `${m.first_name} ${m.last_name}`;
              const isMe = m.id === user.id;
              return (
                <div key={m.id} className="bg-surface border border-line rounded-2xl p-6 text-center shadow-sm hover:shadow-md hover:-translate-y-0.5 transition">
                  <div
                    className="w-16 h-16 rounded-full mx-auto mb-3.5 flex items-center justify-center text-white font-display font-bold text-xl"
                    style={{ background: m.avatar_color ?? "#1f5c2e" }}
                  >
                    {initials(name)}
                  </div>
                  <h3 className="font-display font-bold">
                    {name} {isMe && <span className="text-green-700 text-xs font-sans">(you)</span>}
                  </h3>
                  <div className="text-sm text-ink-500 mt-1">{m.home_club}</div>
                  <div className="flex justify-center gap-2 my-3.5 flex-wrap">
                    {m.county && <span className="bg-cream-100 text-xs font-bold px-2.5 py-1 rounded-full">{m.county}</span>}
                    {m.handicap != null && <span className="bg-red-100 text-red-600 text-xs font-bold px-2.5 py-1 rounded-full">{m.handicap} hcp</span>}
                  </div>
                  <button
                    disabled
                    title={isMe ? undefined : "Messaging is coming in the next update"}
                    className="w-full py-2.5 rounded-full font-bold text-sm border-[1.5px] border-green-700 text-green-700 opacity-40 cursor-not-allowed"
                  >
                    {isMe ? "This is you" : "Connect (soon)"}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
