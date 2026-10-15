import { asId, authenticateAppRequest, badRequest, readJson, unauthenticated } from "@/lib/app-api";
import { buildExport, EXPORT_FILES, ExportError, type ExportFile } from "@/lib/society-exports";
import { ExportStoreError, storeExport } from "@/lib/society-export-store";

/**
 * POST /api/app/societies/[id]/export   { file, outingId? }
 *
 * Builds one of a society's CSV files with the member's OWN client (so the
 * database decides what they may export — see src/lib/society-exports.ts),
 * stores it privately, logs it (society_exports, which the committee can
 * see), and returns a link that downloads it for ten minutes. The app opens
 * the link; the phone offers to save or share the file.
 *
 * The storing, logging and signing are in src/lib/society-export-store.ts,
 * shared with the society console's Exports page. The society's older files
 * are cleared each time, so at most a handful sit in storage at once.
 */
type Body = { file?: string; outingId?: number | null };

export const maxDuration = 30;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateAppRequest(request);
  if (!auth) return unauthenticated();
  const groupId = asId((await params).id);
  if (groupId === null) return badRequest("id must be a positive integer");
  const body = await readJson<Body>(request);
  if (!body?.file || !(EXPORT_FILES as readonly string[]).includes(body.file)) return badRequest("file must be one of " + EXPORT_FILES.join(", "));
  const outingId = body.outingId == null ? null : Number(body.outingId);
  if (outingId !== null && (!Number.isInteger(outingId) || outingId <= 0)) return badRequest("outingId must be a positive integer");

  let built;
  try {
    built = await buildExport(auth.supabase, groupId, body.file as ExportFile, outingId);
  } catch (err) {
    if (err instanceof ExportError) return Response.json({ error: err.message }, { status: 403 });
    console.error("[society-export] build failed", err);
    return Response.json({ error: "Couldn't make the file." }, { status: 500 });
  }

  try {
    return Response.json(await storeExport({ groupId, memberId: auth.user.id, file: body.file as ExportFile, outingId: body.file === "booking" ? outingId : null, built }));
  } catch (err) {
    return Response.json({ error: err instanceof ExportStoreError ? err.message : "Couldn't make the file." }, { status: 500 });
  }
}
