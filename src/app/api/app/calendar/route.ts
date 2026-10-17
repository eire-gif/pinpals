import { asId, authenticateAppRequest, badRequest, readJson, unauthenticated } from "@/lib/app-api";
import { calendarLinkPath, signCalendarToken, tzForCountry, type CalEvent } from "@/lib/calendar-ics";
import { getSiteUrl } from "@/lib/site-url";
import { teeTimeCalendarUrl } from "@/lib/tee-time-calendar";

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
    // Shared with the website's My rounds (src/lib/tee-time-calendar.ts).
    const result = await teeTimeCalendarUrl(auth.supabase, auth.user.id, id);
    if (!result.ok) return Response.json({ error: result.error, reason: result.reason }, { status: result.status });
    return Response.json({ url: result.url });
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
      .select("id, match_number, tee_time, match_type, team_name, live_round_players!inner ( member_id )")
      .eq("match_day_id", id)
      .eq("live_round_players.member_id", auth.user.id)
      .overrideTypes<{ id: number; match_number: number | null; tee_time: string | null; match_type: string | null; team_name: string | null }[]>();
    const match = (rows ?? [])[0] ?? null;
    if (!match && day.created_by !== auth.user.id) return notYours();

    const vs = day.team_names?.length === 2 ? ` · ${day.team_names[0]} v ${day.team_names[1]}` : "";
    event = {
      uid: `match-day-${day.id}${match ? `-m${match.match_number ?? match.id}` : ""}`,
      // A scramble team (0113) has a team name instead of a match number.
      title: match?.match_number ? `⛳ ${day.title} — Match ${match.match_number}` : match?.team_name ? `⛳ ${day.title} — ${match.team_name}` : `⛳ ${day.title}`,
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
