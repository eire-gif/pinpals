import "server-only";

import { randomUUID } from "node:crypto";

import type { Built, ExportFile } from "@/lib/society-exports";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Where a society's CSV goes once buildExport has made it with the MEMBER'S
 * OWN client (so the database has already decided they may have it): stored
 * privately, logged in society_exports (which the committee can see), and a
 * link handed back that downloads it for ten minutes.
 *
 * The service role is used only for these storage and log steps — never to
 * read society data. Shared by the app's route (/api/app/societies/[id]/
 * export) and the society console's Exports page, so both behave alike.
 *
 * The society's older files are cleared each time, so at most a handful sit
 * in storage at once.
 */

const BUCKET = "society-exports";

export class ExportStoreError extends Error {}

export async function storeExport(opts: { groupId: number; memberId: string; file: ExportFile; outingId: number | null; built: Built }): Promise<{ url: string; filename: string; rows: number }> {
  const { groupId, memberId, file, outingId, built } = opts;
  const admin = createAdminClient();
  // Clear this society's earlier files first.
  const { data: old } = await admin.storage.from(BUCKET).list(String(groupId), { limit: 100 });
  if (old?.length) await admin.storage.from(BUCKET).remove(old.map((f) => `${groupId}/${f.name}`));

  const path = `${groupId}/${randomUUID()}.csv`;
  // A BOM so Excel reads the euro signs and accents as UTF-8.
  const { error: upErr } = await admin.storage.from(BUCKET).upload(path, new Blob(["﻿" + built.csv], { type: "text/csv" }), { contentType: "text/csv", upsert: false });
  if (upErr) {
    console.error("[society-export] upload failed", upErr.message);
    throw new ExportStoreError("Couldn't make the file.");
  }
  await admin.from("society_exports").insert({ group_id: groupId, member_id: memberId, file, outing_id: outingId, rows: built.rows });
  const { data: signed, error: signErr } = await admin.storage.from(BUCKET).createSignedUrl(path, 600, { download: built.filename });
  if (signErr || !signed) throw new ExportStoreError("Couldn't make the link.");
  return { url: signed.signedUrl, filename: built.filename, rows: built.rows };
}
