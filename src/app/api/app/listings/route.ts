import {
  authenticateAppRequest,
  readJson,
  unauthenticated,
} from "@/lib/app-api";
import { createListingRecord } from "@/lib/listings-server";
import { MAX_LISTING_IMAGES } from "@/lib/marketplace";
import { createListingSchema } from "@/lib/validation/listing";

/**
 * POST /api/app/listings
 *
 * A member posts a listing from the app. Saved as a draft, exactly like the
 * website's form — publishing stays in publishListing(), which re-checks
 * that the seller can actually take money before anything goes live.
 *
 * Validated with createListingSchema, the same schema the form uses, so the
 * two cannot drift on what a title may be or what a price means. The
 * inserts are createListingRecord()'s, shared for the same reason.
 *
 * ============ What the app deliberately cannot do here ============
 *
 * Auctions. The schema accepts them and createListingRecord() writes them,
 * but this route refuses them: an auction needs a start, an end, a reserve
 * and a minimum increment, and a form asking for all four on a phone is a
 * form nobody finishes standing on a first tee. The app's job is the quick
 * listing — photograph it, price it, post it. A seller who wants an auction
 * has a much better time of it on the website, and the message below says
 * so rather than failing vaguely.
 *
 * The shaft specs (dexterity, flex, material, loft, size) are the same
 * judgement in softer form: the schema leaves them optional, the app omits
 * them, and the listing's edit page on the website is where a seller adds
 * them if they matter. Nothing here rejects them, so the app can grow into
 * them later without a server change.
 */

/** Both the app's sale types. Neither needs a date. */
const APP_SALE_TYPES = ["fixed_price", "offers_allowed"];

type PendingImage = { url: string; position: number };

/**
 * Photo URLs come back from /api/app/listings/images, so by the time they
 * arrive here they are already ours. They are still re-read rather than
 * trusted as a shape: this is a client-supplied JSON array, and a malformed
 * entry should be a 400 rather than a row with "undefined" in it.
 */
function readImages(value: unknown): PendingImage[] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return null;

  const images: PendingImage[] = [];
  for (const [index, item] of value.entries()) {
    if (typeof item !== "object" || item === null) return null;
    const url = (item as { url?: unknown }).url;
    if (typeof url !== "string" || url.trim() === "") return null;
    const position = (item as { position?: unknown }).position;
    images.push({
      url,
      position: typeof position === "number" && Number.isFinite(position) ? position : index,
    });
  }
  return images;
}

export async function POST(request: Request) {
  const auth = await authenticateAppRequest(request);
  if (!auth) return unauthenticated();

  const body = await readJson<Record<string, unknown>>(request);
  if (!body) {
    return Response.json({ error: "Expected a JSON body" }, { status: 400 });
  }

  const images = readImages(body.images);
  if (images === null) {
    return Response.json(
      { error: "Something went wrong with your photos — please re-add them." },
      { status: 400 }
    );
  }
  if (images.length > MAX_LISTING_IMAGES) {
    return Response.json(
      { error: `A listing may have at most ${MAX_LISTING_IMAGES} photos.` },
      { status: 422 }
    );
  }

  if (!APP_SALE_TYPES.includes(String(body.sale_type ?? ""))) {
    return Response.json(
      {
        error: "Auctions are set up on the website — the app posts fixed-price and offers listings.",
        reason: "invalid",
      },
      { status: 422 }
    );
  }

  const parsed = createListingSchema.safeParse({
    title: body.title,
    description: body.description ?? "",
    category: body.category,
    subcategory: body.subcategory ?? "",
    condition: body.condition,
    county: body.county || undefined,
    brand: body.brand || undefined,
    brandOther: body.brand === "other" ? body.brand_other || undefined : undefined,
    deliveryOptions: body.delivery_options,
    collectionNotes: body.collection_notes ?? "",
    saleType: body.sale_type,
    priceEur: body.price_eur,
  });

  if (!parsed.success) {
    // One message per field, first issue wins — the app shows the summary
    // and puts the rest under their own inputs.
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if (typeof key === "string" && !(key in fieldErrors)) {
        fieldErrors[key] = issue.message;
      }
    }
    return Response.json(
      {
        error: parsed.error.issues[0]?.message || "Please check the listing and try again.",
        reason: "invalid",
        fieldErrors,
      },
      { status: 422 }
    );
  }

  const result = await createListingRecord({
    supabase: auth.supabase,
    userId: auth.user.id,
    data: parsed.data,
    images,
  });

  if (!result.ok) {
    return Response.json({ error: result.message, reason: "failed" }, { status: 500 });
  }

  // `images_attached` is reported rather than assumed. The listing saved
  // either way, and an app that says "posted" while the photos silently
  // failed is the failure that looks like success.
  return Response.json(
    { listing_id: result.listingId, images_attached: !result.imagesFailed },
    { status: 201 }
  );
}
