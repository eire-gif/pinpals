import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Connection, Profile } from "@/lib/types";
import MemberCard from "@/components/member-card";

type ConnectionWithFullProfiles = Connection & {
  requester: Profile | null;
  recipient: Profile | null;
};

export default async function ConnectionsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: connections } = await supabase
    .from("connections")
    .select("*, requester:profiles!connections_requester_id_fkey(*), recipient:profiles!connections_recipient_id_fkey(*)")
    .eq("status", "accepted")
    .or(`requester_id.eq.${user.id},recipient_id.eq.${user.id}`)
    .order("updated_at", { ascending: false })
    .returns<ConnectionWithFullProfiles[]>();

  // Kept paired with the connection row rather than flattened to a list of
  // profiles: MemberCard's footer needs the connection to render "Connected
  // / Message" rather than offering to connect with someone you already
  // have. The query already selected the whole profile — only the type was
  // narrow, which is why these cards used to show less than the directory's.
  // flatMap rather than map+filter: it drops the null and narrows the type
  // in one step, where a type predicate would have to restate the whole
  // entry shape just to say "profile isn't null".
  const people = (connections ?? []).flatMap((connection) => {
    const profile = connection.requester_id === user.id ? connection.recipient : connection.requester;
    return profile ? [{ profile, connection: connection as Connection }] : [];
  });

  // Same source as the directory — the member_age_bands view, never a date
  // of birth (supabase/migrations/0059). No row means "not set, or not
  // shared", and both read as "Not shared".
  const memberIds = people.map((p) => p.profile.id);
  const { data: ageBands } = memberIds.length
    ? await supabase
        .from("member_age_bands")
        .select("user_id, age_band")
        .in("user_id", memberIds)
        .returns<{ user_id: string; age_band: string }[]>()
    : { data: [] as { user_id: string; age_band: string }[] };

  const ageBandByMember = new Map((ageBands ?? []).map((r) => [r.user_id, r.age_band]));

  return (
    <div className="max-w-6xl mx-auto px-6 py-10 md:py-14">
      <Link href="/dashboard" className="text-sm font-bold text-green-700 hover:text-green-600">&larr; Back to dashboard</Link>
      <div className="mt-5 mb-8">
        <span className="inline-flex items-center gap-2 text-xs font-bold tracking-widest uppercase text-green-700">
          <span className="w-5 h-0.5 bg-gold-500 inline-block" /> Your network
        </span>
        <h1 className="font-display font-bold text-3xl md:text-4xl mt-2">My connections</h1>
        <p className="text-ink-500 mt-2">All the golfers you have connected with on Pinpals.</p>
      </div>

      {people.length === 0 ? (
        <div className="text-center py-16 text-ink-500">
          You haven&rsquo;t connected with anyone yet —{" "}
          <Link href="/community" className="font-bold text-green-700 hover:underline">
            find golfers near you
          </Link>{" "}
          and send a request.
        </div>
      ) : (
        // The same grid and the same card as /community, so a member you
        // found in the directory looks identical once they're a connection.
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {people.map(({ profile, connection }) => (
            <MemberCard
              key={profile.id}
              member={profile}
              currentUserId={user.id}
              ageBand={ageBandByMember.get(profile.id)}
              connection={connection}
            />
          ))}
        </div>
      )}
    </div>
  );
}
