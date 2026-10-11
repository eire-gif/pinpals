import { authenticateAppRequest, unauthenticated } from "@/lib/app-api";
import { signWidgetToken } from "@/lib/widget-token";

/**
 * POST /api/app/widget/token   → { token, expiresAt }
 *
 * The signed-in member's key for their Home Screen widget (src/lib/
 * widget-token.ts). The app stores it in the App Group the widget reads.
 */
export async function POST(request: Request) {
  const auth = await authenticateAppRequest(request);
  if (!auth) return unauthenticated();
  return Response.json(signWidgetToken(auth.user.id), { headers: { "cache-control": "private, no-store" } });
}
