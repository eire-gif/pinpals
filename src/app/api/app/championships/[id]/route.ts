import { asId, authenticateAppRequest, badRequest, unauthenticated } from "@/lib/app-api";
import { championshipFor } from "@/lib/championship-data";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * GET /api/app/championships/[id]
 *
 * A multi-day championship (0187) for the app: its days and every side's
 * score so far, which the app adds up with championship.ts (so switching
 * between "after day 1, 2, 3" needs no new request). The championship row is
 * read with the member's own client first, so only its group's members get
 * anything back.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateAppRequest(request);
  if (!auth) return unauthenticated();
  const id = asId((await params).id);
  if (id === null) return badRequest("id must be a positive integer");

  const payload = await championshipFor(auth.supabase, createAdminClient(), id, auth.user.id);
  if (!payload) return Response.json({ error: "Championship not found" }, { status: 404 });
  return Response.json(payload, { headers: { "Cache-Control": "no-store" } });
}
