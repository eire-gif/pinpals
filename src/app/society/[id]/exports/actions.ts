"use server";

import { checkRateLimit, rateLimitMessage } from "@/lib/rate-limit";
import { loadConsole } from "@/lib/society-console/access";
import { exportAllowed, EXPORTS, isExportFile } from "@/lib/society-console/exports-rules";
import { positiveInt } from "@/lib/society-console/rules";
import { ExportStoreError, storeExport } from "@/lib/society-export-store";
import { buildExport, ExportError } from "@/lib/society-exports";

/**
 * Makes one of the society's CSV files — what the app's route
 * (/api/app/societies/[id]/export) does, for the console's signed-in
 * member: built with their OWN cookie client (so the database decides what
 * they may export), then stored, logged and signed by the shared
 * storeExport, exactly as the route. Returns a ten-minute download link.
 */

export type ExportResult = { ok: true; url: string; filename: string; rows: number } | { ok: false; error: string };

export async function makeExport(rawGroupId: number, rawFile: string, rawOutingId: number | null): Promise<ExportResult> {
  const groupId = positiveInt(rawGroupId);
  if (!groupId) return { ok: false, error: "That society wasn't found." };
  if (!isExportFile(rawFile)) return { ok: false, error: "Choose a file to download." };
  const outingId = rawOutingId == null ? null : positiveInt(rawOutingId);
  if (rawOutingId != null && outingId == null) return { ok: false, error: "Choose the event." };

  const ctx = await loadConsole(groupId);
  if (!ctx) return { ok: false, error: "You need to be signed in and on this society's committee." };
  const def = EXPORTS.find((e) => e.file === rawFile)!;
  if (!exportAllowed(def, ctx.areas)) return { ok: false, error: "That file isn't one of yours to download." };
  if (def.needsEvent && outingId == null) return { ok: false, error: "Choose which event the booking sheet is for." };
  // Each file clears the society's older ones from storage, so keep it to a
  // sensible pace per member.
  const limit = await checkRateLimit({ action: "society-export", identifier: ctx.user.id, maxHits: 20, windowSeconds: 600 });
  if (!limit.allowed) return { ok: false, error: rateLimitMessage(limit.retryAfterSeconds) };

  let built;
  try {
    built = await buildExport(ctx.supabase, groupId, rawFile, def.needsEvent ? outingId : null);
  } catch (err) {
    if (err instanceof ExportError) return { ok: false, error: err.message };
    console.error("[society-export] build failed", err);
    return { ok: false, error: "Couldn't make the file." };
  }
  try {
    const stored = await storeExport({ groupId, memberId: ctx.user.id, file: rawFile, outingId: def.needsEvent ? outingId : null, built });
    return { ok: true, ...stored };
  } catch (err) {
    return { ok: false, error: err instanceof ExportStoreError ? err.message : "Couldn't make the file." };
  }
}
