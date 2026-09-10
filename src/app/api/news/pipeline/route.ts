import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { runPipeline } from "@/lib/news/pipeline";

/**
 * Triage and drafting, called on a schedule by pg_cron.
 *
 * Same shared-secret gate as /api/news/collect. Note the URL the caller must
 * use: https://www.pinpals.ie/..., not the apex. The apex redirects, and a
 * redirect drops the Authorization header — see migration 0071.
 */

export const dynamic = "force-dynamic";
// Model calls, not fetches: one triage call over a batch plus up to five
// drafting calls. Comfortably inside this, but a hung API must not hold the
// function open indefinitely.
export const maxDuration = 300;

function isAuthorised(request: Request): boolean {
  const expected = process.env.NEWS_CRON_SECRET?.trim();
  if (!expected) return false;

  const header = request.headers.get("authorization") ?? "";
  const presented = (header.startsWith("Bearer ") ? header.slice(7) : header).trim();

  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    console.warn(
      `[news] pipeline auth rejected: presented ${a.length} chars, configured ${b.length} chars`,
    );
    return false;
  }
  const ok = timingSafeEqual(a, b);
  if (!ok) console.warn("[news] pipeline auth rejected: same length, different value");
  return ok;
}

export async function POST(request: Request) {
  if (!isAuthorised(request)) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  if (process.env.NEWS_ENABLED === "false") {
    return NextResponse.json({ skipped: "NEWS_ENABLED is false" }, { status: 200 });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    // Distinct from a 500: nothing is broken, the pipeline simply is not
    // configured to spend money yet.
    return NextResponse.json(
      { skipped: "ANTHROPIC_API_KEY is not set" },
      { status: 200 },
    );
  }

  try {
    const result = await runPipeline();
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    console.error("[news] pipeline run failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Pipeline failed" },
      { status: 500 },
    );
  }
}

export function GET() {
  return NextResponse.json({ error: "Use POST" }, { status: 405 });
}
