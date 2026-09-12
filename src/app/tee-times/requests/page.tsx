import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { MyTeeTimeRequest } from "@/lib/types";
import MyTeeTimeRequests from "@/app/dashboard/my-tee-time-requests";
import TeeTimesTabs from "../tee-times-tabs";
import TeeTimesPageHeader from "../tee-times-page-header";

/**
 * The other side of the same conversation: rounds this member has asked to
 * join, and the places they've been offered.
 *
 * Shows declined requests too, which the dashboard's version filters out.
 * On a dashboard that is right — a rejection isn't a to-do. On a tab called
 * "My requests" it isn't: a member who asked about four rounds and hears
 * nothing wants to know which ones are closed, not to be shown three and
 * left wondering about the fourth.
 */
export default async function MyTeeTimeRequestsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login?next=/tee-times/requests");

  const { data: requests } = await supabase
    .from("tee_time_interests")
    .select(
      "*, tee_time_invites(id, club_name, play_date, time_from, time_to, exact_tee_time, has_tee_time_booked, status)"
    )
    .eq("member_id", user.id)
    .order("created_at", { ascending: false })
    .returns<MyTeeTimeRequest[]>();

  const rows = requests ?? [];
  const awaitingConfirmation = rows.filter((row) => row.status === "accepted");
  // Offers first — this is the one state on this page where the member has
  // something to do, and it expires with the round.
  const ordered = [...awaitingConfirmation, ...rows.filter((row) => row.status !== "accepted")];

  return (
    <div>
      <TeeTimesPageHeader
        eyebrow="My requests"
        title={awaitingConfirmation.length > 0 ? "You've been offered a place." : "Rounds you've asked to join."}
        description="Every tee time you've asked about, and where each one stands. Confirm a place once a host offers you one."
      />
      <TeeTimesTabs active="requests" />

      <div className="max-w-3xl mx-auto px-6 py-12">
        {awaitingConfirmation.length > 0 && (
          <p className="mb-6 rounded-2xl bg-green-100 px-5 py-4 text-sm font-semibold text-green-800">
            {awaitingConfirmation.length === 1
              ? "Confirm your place so the host knows the round is set."
              : `${awaitingConfirmation.length} hosts are waiting for you to confirm.`}
          </p>
        )}

        <MyTeeTimeRequests requests={ordered} />

        {rows.length === 0 && (
          <p className="mt-6 text-sm text-ink-500">
            <Link href="/tee-times" className="font-bold text-green-700">
              Browse open invites
            </Link>{" "}
            to find a round near you.
          </p>
        )}
      </div>
    </div>
  );
}
