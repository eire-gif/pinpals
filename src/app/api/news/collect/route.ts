import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { collectAll } from "@/lib/news/collect";

/**
 * The news collector's entry point, called on a schedule by pg_cron.
 *
 * This is the first scheduled job in the codebase. Everything before it ran
 * in response to a member doing something, or as an opportunistic sweep
 * inside a request someone else paid for. See migration 0069 for why the
 * schedule lives in Postgres rather than in vercel.json.
 *
 * The route is public in the sense that anyone can send it a request, so the
 * shared secret is the whole of its access control. Without a match it must
 * do nothing at all — not even reveal whether the secret is configured.
 */

export const dynamic = "force-dynamic";
// Two sources at ten seconds' spacing, plus fetches. Well inside this, but
// the ceiling matters because a hung upstream must not hold a function open.
export const maxDuration = 60;

function isAuthorised(request: Request): boolean {
  // Trimmed because this value is set by hand in a dashboard, and a secret
  // pasted out of a table cell or a terminal very often carries a trailing
  // newline or space. That is not a different secret, it is the same secret
  // with invisible punctuation, and rejecting it produces a 401 with no way
  // to tell the two cases apart — which is exactly what happened the first
  // time this route was deployed.
  const expected = process.env.NEWS_CRON_SECRET?.trim();

  // An unset secret disables the route rather than opening it. A misconfigured
  // deployment should collect nothing, never collect for anyone who asks.
  if (!expected) return false;

  const header = request.headers.get("authorization") ?? "";
  const presented = (
    header.startsWith("Bearer ") ? header.slice(7) : header
  ).trim();

  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  // timingSafeEqual throws on length mismatch, so compare lengths first —
  // but still run the comparison on equal-length buffers so a wrong secret
  // of the right length takes the same time as a right one.
  if (a.length !== b.length) {
    // Lengths only, and only to the server log — never to the caller. This is
    // the difference between "the variable is missing", "it has stray
    // whitespace" and "it is genuinely a different string", none of which a
    // bare 401 distinguishes.
    console.warn(
      `[news] collect auth rejected: presented ${a.length} chars, configured ${b.length} chars`,
    );
    return false;
  }

  const ok = timingSafeEqual(a, b);
  if (!ok) {
    console.warn("[news] collect auth rejected: same length, different value");
  }
  return ok;
}

export async function POST(request: Request) {
  if (!isAuthorised(request)) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  if (process.env.NEWS_ENABLED === "false") {
    return NextResponse.json({ skipped: "NEWS_ENABLED is false" }, { status: 200 });
  }

  try {
    const result = await collectAll();
    // 200 even when individual sources failed: the run itself succeeded, and
    // per-source failures are recorded on the row and shown in admin. A 500
    // here would make pg_cron retry a fetch that a press office is simply
    // refusing, which helps nobody.
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    console.error("[news] collect run failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Collection failed" },
      { status: 500 },
    );
  }
}

/**
 * GET is deliberately not a collector trigger. A scheduled job that runs on
 * GET is one accidental crawl away from running constantly, and this one
 * makes outbound requests to other people's servers.
 */
export function GET() {
  return NextResponse.json({ error: "Use POST" }, { status: 405 });
}
