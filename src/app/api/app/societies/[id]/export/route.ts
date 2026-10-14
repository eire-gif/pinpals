import { randomUUID } from "node:crypto";

import { asId, authenticateAppRequest, badRequest, readJson, unauthenticated } from "@/lib/app-api";
import { buildExport, EXPORT_FILES, ExportError, type ExportFile } from "@/lib/society-exports";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * POST /api/app/societies/[id]/export   { file, outingId? }
 *
 * Builds one of a society's CSV files with the member's OWN client (so the
 * database decides what they may export — see src/lib/society-exports.ts),
 * stores it privately, logs it (society_exports, which the committee can
 * see), and returns a link that downloads it for ten minutes. The app opens
 * the link; the phone offers to save or share the file.
 *
 * The society's older files are cleared each time, so at most a handful sit
 * in storage at once.
 */
const BUCKET = "society-exports";
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

  const admin = createAdminClient();
  // Clear this society's earlier files first.
  const { data: old } = await admin.storage.from(BUCKET).list(String(groupId), { limit: 100 });
  if (old?.length) await admin.storage.from(BUCKET).remove(old.map((f) => `${groupId}/${f.name}`));

  const path = `${groupId}/${randomUUID()}.csv`;
  // A BOM so Excel reads the euro signs and accents as UTF-8.
  const { error: upErr } = await admin.storage.from(BUCKET).upload(path, new Blob(["﻿" + built.csv], { type: "text/csv" }), { contentType: "text/csv", upsert: false });
  if (upErr) {
    console.error("[society-export] upload failed", upErr.message);
    return Response.json({ error: "Couldn't make the file." }, { status: 500 });
  }
  await admin.from("society_exports").insert({ group_id: groupId, member_id: auth.user.id, file: body.file, outing_id: outingId, rows: built.rows });
  const { data: signed, error: signErr } = await admin.storage.from(BUCKET).createSignedUrl(path, 600, { download: built.filename });
  if (signErr || !signed) return Response.json({ error: "Couldn't make the link." }, { status: 500 });
  return Response.json({ url: signed.signedUrl, filename: built.filename, rows: built.rows });
}
