import { asId, authenticateAppRequest, badRequest, readJson, unauthenticated } from "@/lib/app-api";
import { runHandoverStep, type HandoverStep } from "@/lib/order-handover";

/**
 * POST /api/app/orders/[id]/handover
 *
 *   { step: "meetup", at: ISO, place }      buyer or seller
 *   { step: "code", code: "1234" }          seller — releases the money
 *   { step: "posted", tracking? }           seller
 *   { step: "received" }                    buyer — releases the money
 *   { step: "problem", category?, description? }  buyer — freezes it
 *
 * Buyer Protection (0114). The same runHandoverStep() as the website; the
 * database's order_* functions decide who may take each step.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateAppRequest(request);
  if (!auth) return unauthenticated();
  const orderId = asId((await params).id);
  if (orderId === null) return badRequest("id must be a positive integer");

  const body = await readJson<Record<string, unknown>>(request);
  const str = (v: unknown, max: number) => (typeof v === "string" && v.trim().length <= max ? v.trim() : null);
  let step: HandoverStep;
  switch (body?.step) {
    case "meetup": {
      const at = str(body.at, 40);
      const place = str(body.place, 160);
      if (!at || Number.isNaN(Date.parse(at)) || !place) return badRequest("meetup needs at (ISO time) and place");
      step = { kind: "meetup", at, place };
      break;
    }
    case "code": {
      const code = str(body.code, 8);
      if (!code || !/^\d{4}$/.test(code)) return badRequest("code must be 4 digits");
      step = { kind: "code", code };
      break;
    }
    case "posted":
      step = { kind: "posted", tracking: str(body.tracking, 80) || null };
      break;
    case "received":
      step = { kind: "received" };
      break;
    case "problem":
      step = { kind: "problem", category: str(body.category, 40), description: str(body.description, 4000) };
      break;
    default:
      return badRequest("step must be meetup, code, posted, received or problem");
  }

  const result = await runHandoverStep(auth.supabase, auth.user.id, orderId, step);
  if (!result.ok) return Response.json({ error: result.message }, { status: 409 });
  return Response.json({ ok: true, released: result.released ?? false });
}
