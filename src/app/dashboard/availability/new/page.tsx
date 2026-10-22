import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import NewAvailabilityForm from "./new-availability-form";
import { ageGate } from "@/components/age/age-gate";

export default async function NewAvailabilityPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Carries the destination through the login page, so posting a tee time
  // from the homepage button doesn't dead-end on the dashboard.
  if (!user) redirect("/login?next=/dashboard/availability/new");
  // Junior members (0159): the panel to show instead, if their age keeps them from this.
  const ageBlocked = await ageGate("teeTimes", "Posting a tee time");
  if (ageBlocked) return ageBlocked;

  // 0186: the groups the host can invite in one go.
  const { data: memberships } = await supabase
    .from("group_members")
    .select("group:groups ( id, name, kind, member_count )")
    .eq("member_id", user.id)
    .order("joined_at", { ascending: false })
    .overrideTypes<{ group: { id: number; name: string; kind: string; member_count: number } | null }[]>();
  const groups = (memberships ?? [])
    .map((m) => m.group)
    .filter((g): g is NonNullable<typeof g> => g !== null && g.member_count > 1);

  return (
    <div className="max-w-xl mx-auto px-4 sm:px-6 py-10 sm:py-16">
      <div className="mb-8">
        <span className="inline-flex items-center gap-2 text-xs font-bold tracking-widest uppercase text-green-700">
          <span className="w-5 h-0.5 bg-gold-500 inline-block" /> Tee-time invites
        </span>
        <h1 className="font-display font-bold text-3xl mt-2.5">Post your availability.</h1>
        <p className="text-ink-500 mt-2">
          Let other Pinpals members know you&rsquo;ve got room for a game — it goes live
          straight away. You choose whether it goes to everyone or only to the members
          you&rsquo;ve connected with.
        </p>
      </div>
      <div className="bg-surface rounded-2xl shadow-lg p-5 sm:p-8">
        <NewAvailabilityForm groups={groups} />
      </div>
    </div>
  );
}
