import { asId, authenticateAppRequest, badRequest, readJson, unauthenticated } from "@/lib/app-api";
import { calendarLinkPath, signCalendarToken, tzForCountry, type CalEvent } from "@/lib/calendar-ics";
import { getSiteUrl } from "@/lib/site-url";

/**
 * POST /api/app/calendar  { kind: "tee_time" | "match_day", id }  → { url }
 *
 * A link that puts a round on the member's phone calendar (see
 * src/lib/calendar-ics.ts for why it's a link). Read with the member's own
 * client, so RLS decides what they can see — and only for a round they're
 * in: the host or a confirmed player of a tee time, a player (or the
 * organiser) of a match day.
 */

type Body = { kind?: unknown; id?: unknown };

const HHMM = (t: string | null | undefined) => (t ? t.slice(0, 5) : null);
const notYours = () =>
  Response.json({ error: "You can add this to your calendar once you're confirmed in the round.", reason: "not_in_round" }, { status: 403 });

export async function POST(request: Request) {
  const auth = await authenticateAppRequest(request);
  if (!auth) return unauthenticated();

  const body = await readJson<Body>(request);
  const id = asId(body?.id);
  if (id === null || (body?.kind !== "tee_time" && body?.kind !== "match_day")) return badRequest("Expected { kind, id }.");

  const site = getSiteUrl();
  let event: CalEvent | null = null;

  if (body.kind === "tee_time") {
    const { data: invite } = await auth.supabase
      .from("tee_time_invites")
      .select("id, member_id, status, club_id, club_name, play_date, time_from, exact_tee_time, spaces_available, clubs ( country, town )")
      .eq("id", id)
      .maybeSingle<{
        id: number;
        member_id: string;
        status: string;
        club_id: number | null;
        club_name: string | null;
        play_date: string;
        time_from: string | null;
        exact_tee_time: string | null;
        clubs: { country: string | null; town: string | null } | null;
      }>();
    if (!invite) return Response.json({ error: "That tee time isn't available.", reason: "not_found" }, { status: 404 });

    const hosting = invite.member_id === auth.user.id;
    if (!hosting) {
      const { data: mine } = await auth.supabase
        .from("tee_time_interests")
        .select("status")
        .eq("invite_id", id)
        .eq("member_id", auth.user.id)
        .maybeSingle<{ status: string }>();
      if (!mine || !["confirmed", "accepted"].includes(mine.status)) return notYours();
    }

    const course = invite.club_name ?? "Golf";
    const exact = HHMM(invite.exact_tee_time);
    const from = HHMM(invite.time_from);
    event = {
      uid: `tee-time-${invite.id}`,
      title: `⛳ Golf at ${course}`,
      date: invite.play_date,
      time: exact ?? from,
      tz: tzForCountry(invite.clubs?.country),
      durationMin: 270,
      location: [course, invite.clubs?.town].filter(Boolean).join(", "),
      description: [
        exact ? `Tee time ${exact}.` : from ? `Teeing off from about ${from} — check the exact time in PinPals.` : "Time to be confirmed in PinPals.",
        hosting ? "You're hosting." : "You're playing.",
        "Organised on PinPals.",
      ].join(" "),
      url: `${site}/invite/${invite.id}`,
    };
  } else {
    const { data: day } = await auth.supabase
      .from("live_match_days")
      .select("id, created_by, title, course_name, played_on, team_names, club_id, clubs ( country, town )")
      .eq("id", id)
      .maybeSingle<{
        id: number;
        created_by: string | null;
        title: string;
        course_name: string;
        played_on: string;
        team_names: string[] | null;
        clubs: { country: string | null; town: string | null } | null;
      }>();
    if (!day) return Response.json({ error: "That match day isn't available.", reason: "not_found" }, { status: 404 });

    // The member's own match: its number and tee time.
    const { data: rows } = await auth.supabase
      .from("live_rounds")
      .select("id, match_number, tee_time, match_type, live_round_players!inner ( member_id )")
      .eq("match_day_id", id)
      .eq("live_round_players.member_id", auth.user.id)
      .overrideTypes<{ id: number; match_number: number | null; tee_time: string | null; match_type: string | null }[]>();
    const match = (rows ?? [])[0] ?? null;
    if (!match && day.created_by !== auth.user.id) return notYours();

    const vs = day.team_names?.length === 2 ? ` · ${day.team_names[0]} v ${day.team_names[1]}` : "";
    event = {
      uid: `match-day-${day.id}${match ? `-m${match.match_number ?? match.id}` : ""}`,
      title: match?.match_number ? `⛳ ${day.title} — Match ${match.match_number}` : `⛳ ${day.title}`,
      date: day.played_on,
      time: HHMM(match?.tee_time),
      tz: tzForCountry(day.clubs?.country),
      durationMin: 270,
      location: [day.course_name, day.clubs?.town].filter(Boolean).join(", "),
      description: `${day.course_name}${vs}.${match?.match_type ? ` ${match.match_type[0].toUpperCase()}${match.match_type.slice(1)}.` : ""} Live scores in PinPals.`,
      url: `${site}/live/days/${day.id}`,
    };
  }

  return Response.json({ url: `${site}${calendarLinkPath(signCalendarToken(event))}` });
}
