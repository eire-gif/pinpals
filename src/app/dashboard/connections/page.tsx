import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { ConnectionProfile, ConnectionWithProfiles } from "@/lib/types";
import ConnectionList from "../connection-list";

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
    .returns<ConnectionWithProfiles[]>();

  const people = (connections ?? [])
    .map((connection) => connection.requester_id === user.id ? connection.recipient : connection.requester)
    .filter((person): person is ConnectionProfile => person !== null);

  return (
    <div className="max-w-5xl mx-auto px-6 py-10 md:py-14">
      <Link href="/dashboard" className="text-sm font-bold text-green-700 hover:text-green-600">&larr; Back to dashboard</Link>
      <div className="mt-5 mb-8">
        <span className="inline-flex items-center gap-2 text-xs font-bold tracking-widest uppercase text-green-700">
          <span className="w-5 h-0.5 bg-gold-500 inline-block" /> Your network
        </span>
        <h1 className="font-display font-bold text-3xl md:text-4xl mt-2">My connections</h1>
        <p className="text-ink-500 mt-2">All the golfers you have connected with on Pinpals.</p>
      </div>
      <ConnectionList people={people} />
    </div>
  );
}

