import { NextResponse } from "next/server";
import { isCronAuthorised } from "@/lib/cron-auth";
import { runDueDeletions } from "@/lib/account-deletion";

/**
 * Completes account deletions whose grace period has expired.
 *
 * Called on a schedule by pg_cron, the same way the news collector is — see
 * migration 0069 for why the schedule lives in Postgres rather than in
 * vercel.json. Running daily is enough: the window is thirty days, so a few
 * hours either side of the exact moment changes nothing a member would
 * notice, and a job this destructive should run at a predictable quiet hour
 * rather than constantly.
 *
 * Anyone can send this route a request, so the shared secret is the whole of
 * its access control.
 */

export const dynamic = "force-dynamic";
// Each scrub touches a dozen tables and two Admin API calls. A backlog of
// several still finishes well inside this, and it matches the news
// collector's ceiling rather than assuming a longer one is available.
export const maxDuration = 60;

export async function POST(request: Request) {
  if (!isCronAuthorised(request, process.env.ACCOUNT_DELETION_CRON_SECRET, "account-deletion")) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  try {
    const summary = await runDueDeletions();

    if (summary.due > 0) {
      console.info(
        `[account-deletion] ${summary.completed}/${summary.due} completed`,
        summary.outcomes
      );
    }

    // 200 even when an individual scrub failed: the run itself succeeded, the
    // failure is logged with its request id, and the row stays incomplete so
    // the next run picks it up. A 500 would make pg_cron retry the whole
    // batch, re-running scrubs that already worked.
    return NextResponse.json(summary, { status: 200 });
  } catch (error) {
    console.error("[account-deletion] run failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Run failed" },
      { status: 500 }
    );
  }
}

/**
 * GET is deliberately not a trigger. A scheduled job that runs on GET is one
 * accidental crawl away from running constantly, and this one deletes people.
 */
export function GET() {
  return NextResponse.json({ error: "Use POST" }, { status: 405 });
}
