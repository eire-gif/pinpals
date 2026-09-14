import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { TeeTimeInvite } from "@/lib/types";
import {
  LADIES_ONLY_BADGE,
  formatClock,
  formatInviteDate,
  formatTimeRange,
  partitionConfirmedRounds,
  todayIsoDate,
  type ConfirmedRound,
} from "@/lib/tee-times";
import TeeTimesTabs from "../tee-times-tabs";
import TeeTimesPageHeader from "../tee-times-page-header";

/**
 * Rounds that are actually happening.
 *
 * The two management tabs either side of this one are about rounds still
 * being negotiated — someone waiting on your answer, you waiting on theirs.
 * This is the answer to a different and simpler question, and the one a
 * member asks most often: *what am I playing, and when?* Until now that
 * lived nowhere. A confirmed place appeared as a green "Confirmed" chip
 * among the requests on the dashboard, which is a record of a conversation
 * that ended, not a diary.
 *
 * ============ Two queries, because there are two ways to be in a round ============
 *
 * A member is in a settled round either because they posted it and somebody
 * confirmed, or because they asked to join one and confirmed their own
 * place. Those are different rows in different tables and no single query
 * reaches both, so both run and the results are reduced to one
 * `ConfirmedRound` shape and sorted together. A member who hosts one round a
 * month and joins two has three rounds, and wants them in date order, not
 * grouped by which side of the invite they happen to be on.
 */
export default async function ConfirmedTeeTimesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login?next=/tee-times/confirmed");

  type HostedRow = TeeTimeInvite & {
    tee_time_interests: {
      id: number;
      status: string;
      profiles: { first_name: string; last_name: string; home_club: string | null } | null;
    }[];
  };

  type JoinedRow = {
    id: number;
    tee_time_invites:
      | (TeeTimeInvite & {
          profiles: { first_name: string; last_name: string; home_club: string | null } | null;
        })
      | null;
  };

  const [{ data: hosted }, { data: joined }] = await Promise.all([
    // Rounds this member posted, with the golfers who confirmed. The !inner
    // join plus the status filter means an invite nobody has confirmed on
    // never reaches this page at all — an empty round is not a fixture.
    supabase
      .from("tee_time_invites")
      .select(
        "*, tee_time_interests!inner(id, status, profiles(first_name, last_name, home_club))"
      )
      .eq("member_id", user.id)
      .eq("tee_time_interests.status", "confirmed")
      .returns<HostedRow[]>(),
    // Rounds this member confirmed a place on, with whoever posted them.
    supabase
      .from("tee_time_interests")
      .select("id, tee_time_invites(*, profiles(first_name, last_name, home_club))")
      .eq("member_id", user.id)
      .eq("status", "confirmed")
      .returns<JoinedRow[]>(),
  ]);

  const name = (p: { first_name: string; last_name: string } | null) =>
    p ? `${p.first_name} ${p.last_name}`.trim() : "A Pinpals member";

  const rounds: ConfirmedRound[] = [
    ...(hosted ?? []).map((invite) => ({
      inviteId: invite.id,
      role: "host" as const,
      clubName: invite.club_name,
      playDate: invite.play_date,
      timeFrom: invite.time_from,
      timeTo: invite.time_to,
      exactTeeTime: invite.exact_tee_time,
      hasTeeTimeBooked: invite.has_tee_time_booked,
      county: invite.county,
      ladiesOnly: invite.ladies_only,
      playing: invite.tee_time_interests.map((interest) => ({
        name: name(interest.profiles),
        homeClub: interest.profiles?.home_club ?? null,
      })),
      hostName: null,
    })),
    ...(joined ?? []).flatMap((interest) => {
      const invite = interest.tee_time_invites;
      // A confirmed place whose invite the host has since deleted. The
      // cascade removes the interest too, so this is only reachable mid-
      // delete — skipped rather than rendered as a round with no club.
      if (!invite) return [];
      return [
        {
          inviteId: invite.id,
          role: "player" as const,
          clubName: invite.club_name,
          playDate: invite.play_date,
          timeFrom: invite.time_from,
          timeTo: invite.time_to,
          exactTeeTime: invite.exact_tee_time,
          hasTeeTimeBooked: invite.has_tee_time_booked,
          county: invite.county,
          ladiesOnly: invite.ladies_only,
          // Deliberately empty — see ConfirmedRound.playing. A guest cannot
          // read the other guests' interest rows.
          playing: [],
          hostName: name(invite.profiles),
        },
      ];
    }),
  ];

  const { upcoming, past } = partitionConfirmedRounds(rounds, todayIsoDate());
  const next = upcoming[0];

  return (
    <div>
      <TeeTimesPageHeader
        eyebrow="Confirmed"
        title={
          next
            ? `Next up: ${next.clubName}, ${formatInviteDate(next.playDate)}.`
            : "Your confirmed rounds."
        }
        description="Every tee time that's settled — rounds you're hosting with a golfer confirmed, and places you've confirmed on someone else's."
      />
      <TeeTimesTabs active="confirmed" />

      <div className="max-w-3xl mx-auto px-6 py-12">
        {upcoming.length === 0 && past.length === 0 ? (
          <div className="text-center py-12 text-ink-500">
            <p>Nothing confirmed yet.</p>
            <p className="mt-3 text-sm">
              <Link href="/tee-times" className="font-bold text-green-700">
                Browse open invites
              </Link>{" "}
              or{" "}
              <Link href="/dashboard/availability/new" className="font-bold text-green-700">
                post your own availability
              </Link>
              .
            </p>
          </div>
        ) : (
          <>
            <section>
              <h2 className="font-display font-bold text-xl mb-4">
                Coming up{upcoming.length > 0 && <span className="text-ink-500 font-sans text-base font-semibold"> · {upcoming.length}</span>}
              </h2>
              {upcoming.length === 0 ? (
                <p className="text-sm text-ink-500 mb-10">
                  No rounds booked in.{" "}
                  <Link href="/tee-times" className="font-bold text-green-700">
                    Find a game
                  </Link>
                  .
                </p>
              ) : (
                <div className="grid gap-4 mb-12">
                  {upcoming.map((round) => (
                    <RoundCard key={`${round.role}-${round.inviteId}`} round={round} />
                  ))}
                </div>
              )}
            </section>

            {past.length > 0 && (
              <section className="border-t border-line pt-10">
                <h2 className="font-display font-bold text-xl mb-1">Already played</h2>
                <p className="text-sm text-ink-500 mb-4">
                  Kept so you can look back at who you played with and when.
                </p>
                <div className="grid gap-4">
                  {past.map((round) => (
                    <RoundCard key={`${round.role}-${round.inviteId}`} round={round} past />
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function RoundCard({ round, past = false }: { round: ConfirmedRound; past?: boolean }) {
  const timeRange = formatTimeRange(round.timeFrom, round.timeTo);
  const exactTime = formatClock(round.exactTeeTime);

  return (
    <div
      className={`bg-surface border border-line rounded-2xl p-6 shadow-sm ${past ? "opacity-75" : ""}`}
    >
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <span className="text-[11.5px] uppercase tracking-wider text-green-700 font-bold">
            {formatInviteDate(round.playDate)}
          </span>
          <h3 className="font-display font-bold text-lg mt-1">{round.clubName}</h3>
          {round.county && <p className="text-xs text-ink-500 mt-0.5">{round.county}</p>}
        </div>
        {/* Says which side of the round this member is on, because the rest
            of the card reads differently depending on it — "playing with"
            below is a full list for one and a single name for the other. */}
        <span
          className={`shrink-0 text-xs font-bold px-2.5 py-1 rounded-full ${
            round.role === "host" ? "bg-green-700 text-cream-50" : "bg-cream-100 text-ink-900"
          }`}
        >
          {round.role === "host" ? "You're hosting" : "You're playing"}
        </span>
      </div>

      <div className="flex flex-wrap gap-2 mt-4">
        {exactTime && (
          <span className="bg-cream-100 text-xs font-bold px-2.5 py-1 rounded-full">
            Tee time {exactTime}
          </span>
        )}
        {timeRange && !exactTime && (
          <span className="bg-cream-100 text-xs font-bold px-2.5 py-1 rounded-full">{timeRange}</span>
        )}
        {round.hasTeeTimeBooked && (
          <span className="bg-green-100 text-green-800 text-xs font-bold px-2.5 py-1 rounded-full">
            Tee time booked
          </span>
        )}
        {round.ladiesOnly && (
          <span className="bg-green-700 text-cream-50 text-xs font-bold px-2.5 py-1 rounded-full">
            {LADIES_ONLY_BADGE}
          </span>
        )}
      </div>

      <div className="border-t border-line mt-5 pt-4 text-sm">
        {round.role === "host" ? (
          <>
            <span className="text-ink-500">Playing with </span>
            <span className="font-semibold text-ink-900">
              {round.playing.map((p) => p.name).join(", ")}
            </span>
            {round.playing.some((p) => p.homeClub) && (
              <p className="text-xs text-ink-500 mt-1">
                {round.playing
                  .filter((p) => p.homeClub)
                  .map((p) => `${p.name} — ${p.homeClub}`)
                  .join(" · ")}
              </p>
            )}
          </>
        ) : (
          <>
            <span className="text-ink-500">Hosted by </span>
            <span className="font-semibold text-ink-900">{round.hostName}</span>
            {/* Said plainly rather than left as an absence. Only the host can
                read who else confirmed (RLS, 0004), so a guest seeing no
                other names should not conclude there are none. */}
            <p className="text-xs text-ink-500 mt-1">
              Only the host can see the full list of who else is playing.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
