import { buildIcs, verifyCalendarToken } from "@/lib/calendar-ics";

/**
 * GET /cal/<token> — the round as an .ics file. Opened in Safari from the
 * app; an iPhone shows it with "Add to Calendar". The signed token is the
 * event (src/lib/calendar-ics.ts), so this needs no session.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const event = verifyCalendarToken(decodeURIComponent(token).replace(/\.ics$/, ""));
  if (!event) {
    return new Response("This calendar link has expired. Open the round in PinPals and tap Add to calendar again.", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
  return new Response(buildIcs(event), {
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": 'inline; filename="pinpals-round.ics"',
      "cache-control": "private, no-store",
    },
  });
}
