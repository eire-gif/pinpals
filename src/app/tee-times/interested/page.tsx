import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { focusedInvite } from "@/lib/tee-time-focus";
import type { InterestWithDetails } from "@/lib/types";
import InterestedGolfers from "@/app/dashboard/interested-golfers";
import TeeTimesTabs from "../tee-times-tabs";
import TeeTimesPageHeader from "../tee-times-page-header";

/**
 * Requests waiting on the host's answer.
 *
 * The UI itself is the component the dashboard already renders — this page
 * exists to put it where members actually look. Imported from its dashboard
 * folder rather than moved, deliberately: moving it would mean editing an
 * 18KB dashboard page in the same change as everything else in 0077, and a
 * component shared by two routes belongs in src/components/ rather than
 * either route. Worth doing as its own tidy-up, not bundled into this one.
 *
 * The query is the dashboard's, unchanged. RLS already scopes interests to
 * invites the caller hosts; the !inner join is what lets the filter reach
 * the invite's owner column directly.
 */
export default async function InterestedGolfersPage({ searchParams }: { searchParams: Promise<{ invite?: string | string[] }> }) {
  // ?invite=<id>: opened from an alert about one round — show only that round.
  const focus = focusedInvite((await searchParams).invite);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect(`/login?next=${encodeURIComponent(focus === null ? "/tee-times/interested" : `/tee-times/interested?invite=${focus}`)}`);

  const { data: interests } = await supabase
    .from("tee_time_interests")
    .select(
      "*, profiles(first_name, home_club, handicap, handicap_visible, avatar_color), tee_time_invites!inner(id, club_name, play_date, member_id)"
    )
    .eq("tee_time_invites.member_id", user.id)
    .order("created_at", { ascending: false })
    .returns<InterestWithDetails[]>();

  const rows = (interests ?? []).filter((row) => focus === null || row.tee_time_invites?.id === focus);
  const pending = rows.filter((row) => row.status === "pending");
  // Pending first. A host opening this tab has come to answer somebody, and
  // a list ordered purely by date buries that under rounds already settled.
  const ordered = [...pending, ...rows.filter((row) => row.status !== "pending")];

  return (
    <div>
      <TeeTimesPageHeader
        eyebrow="Interested golfers"
        title={pending.length > 0 ? "Someone wants to play." : "Requests to join your rounds."}
        description="Golfers who've asked for a place on a tee time you posted. Offer them a space or decline — either way they'll be told."
      />
      <TeeTimesTabs active="interested" />

      <div className="max-w-3xl mx-auto px-6 py-12">

        {focus !== null && (
          <p className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-cream-100 px-5 py-3 text-sm text-ink-900">
            <span>Showing just the round this alert was about.</span>
            <Link href="/tee-times/interested" className="font-bold text-green-700">
              Show all
            </Link>
          </p>
        )}
        {pending.length > 0 && (
          <p className="mb-6 rounded-2xl bg-green-100 px-5 py-4 text-sm font-semibold text-green-800">
            {pending.length === 1
              ? "1 golfer is waiting on your answer."
              : `${pending.length} golfers are waiting on your answer.`}
          </p>
        )}

        <InterestedGolfers interests={ordered} />
      </div>
    </div>
  );
}
