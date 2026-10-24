import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { focusedInvite } from "@/lib/tee-time-focus";
import { loadMyRounds } from "@/lib/my-rounds-server";
import { ageGate } from "@/components/age/age-gate";
import TeeTimesTabs from "../tee-times-tabs";
import TeeTimesPageHeader from "../tee-times-page-header";
import MyRoundsBoard, { type BoardFilter } from "./my-rounds-board";
import { loadTrust, type Trust } from "@/lib/trust-server";
import { toMark, type AttendanceMark, type AttendanceRow } from "@/lib/reliability";

/**
 * My rounds on the website (Oct 2026) — every tee time a member is part
 * of, on one page. The same page as the app's (mobile/src/app/my-rounds.tsx),
 * built from the same rules (src/lib/my-rounds-rules.ts, identical in both).
 * Design and rules: claude/my-rounds-redesign.md.
 *
 * Replaces Interested golfers, My requests and Confirmed; those routes
 * redirect here, carrying ?invite.
 *
 *   ?invite=<id>   opens on All, scrolled to that round (every tee-time
 *                  notification links to the old pages with this)
 *   ?show=hosting|playing|requested   opens on that tab
 */
export const metadata = { title: "My rounds · PinPals" };

const FILTERS: BoardFilter[] = ["all", "hosting", "playing", "requested"];

/**
 * "Now", on Irish wall-clock time. Tee times are stored as the course's
 * local time without a zone, and the server runs in UTC — so "is this
 * morning's round over yet" has to be asked in the same clock the round was
 * booked in, or a 10am round moves to Played an hour late all summer.
 */
function irishNow(): Date {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Dublin" }));
}

export default async function MyRoundsPage({
  searchParams,
}: {
  searchParams: Promise<{ invite?: string | string[]; show?: string | string[] }>;
}) {
  const params = await searchParams;
  const focus = focusedInvite(params.invite);
  const showRaw = Array.isArray(params.show) ? params.show[0] : params.show;
  const show = FILTERS.includes(showRaw as BoardFilter) ? (showRaw as BoardFilter) : "all";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    const here = focus !== null ? `/tee-times/mine?invite=${focus}` : show !== "all" ? `/tee-times/mine?show=${show}` : "/tee-times/mine";
    redirect(`/login?next=${encodeURIComponent(here)}`);
  }

  // Junior members (0159): the panel to show instead, if their age keeps them from this.
  const ageBlocked = await ageGate("teeTimes", "Tee times");
  if (ageBlocked) return ageBlocked;

  let view = null;
  try {
    view = await loadMyRounds(supabase, user.id, irishNow());
  } catch {
    view = null;
  }

  // Trust (0188): badges on the golfers asking to join, and no-shows on
  // played rounds (the host's marks, and any against me).
  let trust: Record<string, Trust> = {};
  let marks: AttendanceMark[] = [];
  if (view) {
    const askers = view.needs.flatMap((n) => (n.kind === "request" ? [n.person.id] : []));
    const playedIds = view.played.map((p) => p.inviteId);
    const [trustMap, attendance] = await Promise.all([
      loadTrust(supabase, askers),
      playedIds.length > 0
        ? supabase
            .from("tee_time_attendance")
            .select("invite_id, member_id, outcome, disputed_at, resolution")
            .in("invite_id", playedIds)
            .overrideTypes<AttendanceRow[]>()
        : Promise.resolve({ data: [] as AttendanceRow[] }),
    ]);
    trust = Object.fromEntries(trustMap);
    marks = (attendance.data ?? []).map(toMark);
  }
  const today = irishNow().toISOString().slice(0, 10);

  const needs = view?.needs.length ?? 0;
  const coming = view?.counts.all ?? 0;

  return (
    <div className="bg-cream-50 min-h-screen">
      <TeeTimesPageHeader
        eyebrow="My rounds"
        title={needs > 0 ? `${needs === 1 ? "1 round needs" : `${needs} rounds need`} your answer.` : "Your rounds, all in one place."}
        description={`${coming} ${coming === 1 ? "round" : "rounds"} coming up — the ones you're hosting, playing in, and have asked to join.`}
      />
      <TeeTimesTabs active="mine" />

      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 sm:py-10">
        {view ? (
          <MyRoundsBoard
            view={view}
            focusId={focus}
            startFilter={focus !== null ? "all" : show}
            trust={trust}
            marks={marks}
            me={user.id}
            today={today}
          />
        ) : (
          <p className="rounded-2xl bg-red-100 px-5 py-4 text-sm font-semibold text-red-600">
            Couldn&apos;t load your rounds just now. Refresh the page to try again.
          </p>
        )}
      </div>
    </div>
  );
}
