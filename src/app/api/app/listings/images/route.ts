import { authenticateAppRequest, unauthenticated } from "@/lib/app-api";
import { ImageProcessingError, uploadListingImage } from "@/lib/images/upload";

/**
 * POST /api/app/listings/images
 *
 * One listing photo from the app. Multipart, field name `file`.
 *
 * THIS IS WHY THE APP DOES NOT UPLOAD TO STORAGE DIRECTLY. A phone photo
 * carries EXIF: the camera, the timestamp, and — for anyone who has ever
 * said yes to a location prompt — the GPS coordinates of where it was
 * taken. Listing photos are public. A member photographing a driver in
 * their own hallway would be publishing their home address in the file.
 *
 * uploadListingImage() re-encodes every photo through sharp, which carries
 * metadata through only when .withMetadata() is called and it never is, so
 * the output is metadata-free by construction rather than by a step someone
 * could forget. Routing the app through the same function means there is
 * still exactly one place that can be got wrong, rather than one per
 * client.
 *
 * One photo per request, matching the website: the app uploads each
 * selected photo as it is chosen and keeps per-photo state, so a failure is
 * one thumbnail to retry rather than a whole submission to redo.
 */
export async function POST(request: Request) {
  const auth = await authenticateAppRequest(request);
  if (!auth) return unauthenticated();

  let file: unknown;
  try {
    const form = await request.formData();
    file = form.get("file");
  } catch {
    return Response.json(
      { error: "Expected a multipart form with a file." },
      { status: 400 }
    );
  }

  if (!(file instanceof File)) {
    return Response.json({ error: "No photo received." }, { status: 400 });
  }

  try {
    const { url, path } = await uploadListingImage(auth.supabase, auth.user.id, file);
    return Response.json({ url, path }, { status: 201 });
  } catch (err) {
    // ImageProcessingError's messages are written for the seller — "Photos
    // must be under 5MB", "That file doesn't look like a valid image" — so
    // they go straight through. 422: the request was understood, the photo
    // is the problem, and it is the member who can fix it.
    if (err instanceof ImageProcessingError) {
      return Response.json({ error: err.message, reason: "invalid" }, { status: 422 });
    }
    return Response.json(
      { error: "Couldn't upload that photo — please try again." },
      { status: 500 }
    );
  }
}
