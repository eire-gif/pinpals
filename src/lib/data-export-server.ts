import "server-only";
import type { User } from "@supabase/supabase-js";

import { createAdminClient } from "@/lib/supabase/admin";
import { EXPORT_NOTES, EXPORT_ROW_LIMIT, EXPORT_SOURCES, scrubRow, type DataExport, type ExportSection } from "@/lib/data-export";

/**
 * Builds a member's data export (see data-export.ts for what is in and out).
 *
 * Read with the service role, filtered to the one member on every query —
 * some of what is theirs (orders, payouts, deletion requests) isn't readable
 * by their own client, and the export has to be complete. The caller has
 * already proved who the member is; nothing here takes an id from a request.
 */
export async function buildDataExport(user: User): Promise<DataExport> {
  const admin = createAdminClient();
  const sections: Record<string, ExportSection> = {};

  await Promise.all(
    EXPORT_SOURCES.map(async (src) => {
      const { data, error } = await admin.from(src.table).select("*").eq(src.column, user.id).limit(EXPORT_ROW_LIMIT + 1);
      if (error) {
        // A table this database doesn't have yet (a migration not applied).
        sections[src.section] = { about: src.about, rows: [], unavailable: true };
        return;
      }
      const rows = (data ?? []) as Record<string, unknown>[];
      sections[src.section] = {
        about: src.about,
        rows: rows.slice(0, EXPORT_ROW_LIMIT).map(scrubRow),
        ...(rows.length > EXPORT_ROW_LIMIT ? { truncated: true as const } : {}),
      };
    })
  );

  // Keep the file in the order of the list, not the order the queries landed.
  const ordered: Record<string, ExportSection> = {};
  for (const src of EXPORT_SOURCES) ordered[src.section] = sections[src.section];

  return {
    generated_at: new Date().toISOString(),
    member_id: user.id,
    account: {
      email: user.email ?? null,
      phone: user.phone ? user.phone : null,
      created_at: user.created_at ?? null,
      last_sign_in_at: user.last_sign_in_at ?? null,
    },
    notes: EXPORT_NOTES,
    sections: ordered,
  };
}
