import { authenticateAppRequest, badRequest, unauthenticated } from "@/lib/app-api";
import { getSiteUrl } from "@/lib/site-url";
import { signWrappedToken, wrappedPhotoPath } from "@/lib/wrapped-links";

/**
 * POST /api/app/wrapped/share  { year }  → { imageUrl }
 *
 * A link to the signed-in member's own year as a story-sized picture
 * (PinPals Wrapped, claude/wrapped.md). Signed, not stored: the picture
 * route reads the member's cards when it's opened.
 */
export async function POST(request: Request) {
  const auth = await authenticateAppRequest(request);
  if (!auth) return unauthenticated();
  let year: unknown;
  try {
    year = ((await request.json()) as { year?: unknown }).year;
  } catch {
    return badRequest("Send the year.");
  }
  const thisYear = new Date().getFullYear();
  if (typeof year !== "number" || !Number.isInteger(year) || year < 2026 || year > thisYear) return badRequest("That year isn't available.");
  const token = signWrappedToken(auth.user.id, year);
  return Response.json({ imageUrl: `${getSiteUrl()}${wrappedPhotoPath(token)}` });
}
