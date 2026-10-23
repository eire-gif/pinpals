import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import ChampionshipBoard from "@/components/championship-board";
import { championshipFor } from "@/lib/championship-data";
import { positiveInt } from "@/lib/society-console/rules";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

// Live scores, per member: never cached.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Leaderboard · PinPals", robots: { index: false, follow: false } };

/**
 * A multi-day championship's leaderboard (0187), for the group's members —
 * the same board as the app, bigger. ?tv=1 fills the screen with larger type
 * for a clubhouse TV or a laptop on HDMI; it refreshes itself while a day is
 * live.
 */
export default async function ChampionshipPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tv?: string }> }) {
  const { id: raw } = await params;
  const { tv } = await searchParams;
  const id = positiveInt(raw);
  if (!id) notFound();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/championships/${id}${tv === "1" ? "?tv=1" : ""}`)}`);

  const data = await championshipFor(supabase, createAdminClient(), id, user.id);
  if (!data) notFound();

  if (tv === "1") return <ChampionshipBoard data={data} me={user.id} tv refresh={20} />;
  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <ChampionshipBoard data={data} me={user.id} />
      <p className="text-sm text-ink-500 mt-4">
        Putting it on a TV? Open{" "}
        <a className="font-semibold text-green-700 underline" href={`/championships/${id}?tv=1`}>
          the full-screen board
        </a>{" "}
        on the TV&apos;s browser — it refreshes itself while a round is on.
      </p>
    </div>
  );
}
