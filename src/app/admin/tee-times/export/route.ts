import type { NextRequest } from "next/server";
import { requireStaff } from "@/lib/admin/authorization";
import { listTeeTimeInvites } from "@/lib/admin/queries";
import { recordAdminAction } from "@/lib/admin/audit";
import { toCsv, type CsvValue } from "@/lib/admin/csv";
import {
  clipToExportLimit,
  csvFilename,
  csvResponse,
  exportTruncated,
} from "@/lib/admin/export";
import { INVITE_STATUS_LABELS, personName, statusLabel } from "@/lib/admin/format";
import { countryName } from "@/lib/regions";

/**
 * CSV export of /admin/tee-times — every tee-time invite, one row each.
 * Open to any active staff member, the same gate as the page, and carrying
 * no email addresses (see the gating rule in src/lib/admin/export.ts).
 *
 * Unlike every other export route, this one clips in memory rather than
 * asking the database for EXPORT_MAX_ROWS: listTeeTimeInvites() has never
 * been paginated — it reads the table and filters in JavaScript — so there is
 * no pageSize to pass it. clipToExportLimit() keeps the file bounded and
 * still reports the true total to the audit log. If that query is ever
 * paginated properly, this route should move to the same shape as the others
 * rather than keep its own.
 *
 * `visibility` (0065) is included because it is the column that explains why
 * an invite with four spaces got no interest: a connections-only invite was
 * only ever offered to the host's own connections.
 */
export const dynamic = "force-dynamic";

const HEADERS = [
  "Invite ID",
  "Status",
  "Club",
  "Club ID",
  "Country",
  "County",
  "Play date",
  "Exact tee time",
  "From",
  "To",
  "Spaces available",
  "Tee time booked",
  "Handicap limit",
  "Audience",
  "Ladies only",
  "Interested golfers",
  "Host ID",
  "Host name",
  "Notes",
  "Posted at",
  "Expires at",
] as const;

export async function GET(request: NextRequest) {
  const { user, staff } = await requireStaff();

  const sp = request.nextUrl.searchParams;
  const q = sp.get("q") ?? "";
  const status = sp.get("status") ?? "";

  const { rows, total } = clipToExportLimit(await listTeeTimeInvites(q, status));

  const body: CsvValue[][] = rows.map((i) => [
    i.id,
    statusLabel(INVITE_STATUS_LABELS, i.status),
    i.club_name,
    i.club_id,
    i.country ? countryName(i.country) : null,
    i.county,
    i.play_date,
    i.exact_tee_time,
    i.time_from,
    i.time_to,
    i.spaces_available,
    i.has_tee_time_booked,
    i.handicap_limit,
    // "Everyone" / "Connections only" rather than the raw enum — the file is
    // read by people, and the raw value reads as a database detail.
    i.visibility === "connections" ? "Connections only" : "Everyone",
    i.ladies_only,
    i.interest_count,
    i.member_id,
    i.host ? personName(i.host) : null,
    i.notes,
    i.created_at,
    i.expires_at,
  ]);

  await recordAdminAction({
    actor: { id: user.id, role: staff.role },
    action: "export.tee_times",
    targetType: "tee_time_invite",
    metadata: {
      rowCount: body.length,
      matchedTotal: total,
      truncated: exportTruncated(total),
      includesEmail: false,
      filters: { q, status },
    },
  });

  return csvResponse(csvFilename("tee-times"), toCsv(HEADERS, body));
}
