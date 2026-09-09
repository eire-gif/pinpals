import type { NextRequest } from "next/server";
import { requireStaff } from "@/lib/admin/authorization";
import { listUsers, isUserSuspended } from "@/lib/admin/queries";
import { recordAdminAction } from "@/lib/admin/audit";
import { toCsv, type CsvValue } from "@/lib/admin/csv";
import {
  EXPORT_MAX_ROWS,
  USER_EXPORT_ROLES,
  csvFilename,
  csvResponse,
  exportTruncated,
} from "@/lib/admin/export";

/**
 * CSV export of /admin/users — the full member list, with email addresses.
 *
 * Gated to super_admin ONLY, deliberately tighter than the page it sits on
 * (which any active staff role can view). Viewing members twenty at a time
 * behind a search box and downloading the entire membership as a portable
 * file are different acts with different consequences, and the support role
 * needs the first but not the second.
 *
 * The GUI membership number is deliberately excluded. It is a golf-body
 * identifier with no admin-reporting use this app has, and every field left
 * out of this file is one that cannot leak from it. Handicap, club and
 * county are included: they are visible to every signed-in member in the
 * directory already (profiles' own SELECT policy, 0001), so they add nothing
 * to the file's sensitivity beyond what the email address already carries.
 */
export const dynamic = "force-dynamic";

const HEADERS = [
  "User ID",
  "First name",
  "Last name",
  "Email",
  "Home club",
  "County",
  "Handicap",
  "Suspended",
  "Suspended until",
  "Joined at",
] as const;

export async function GET(request: NextRequest) {
  const { user, staff } = await requireStaff({ roles: USER_EXPORT_ROLES });

  const sp = request.nextUrl.searchParams;
  const q = sp.get("q") ?? "";
  const suspendedOnly = sp.get("suspended") === "1";

  const { rows, total } = await listUsers(q, suspendedOnly, 1, EXPORT_MAX_ROWS);

  const body: CsvValue[][] = rows.map((u) => [
    u.id,
    u.first_name,
    u.last_name,
    u.email,
    u.home_club,
    u.county,
    u.handicap,
    isUserSuspended(u),
    // Only meaningful while a suspension is actually in effect — a lapsed
    // banned_until is left behind by Supabase Auth rather than cleared (see
    // isUserSuspended()), and exporting a stale date as if it were live
    // would misrepresent the member's status.
    isUserSuspended(u) ? u.banned_until : null,
    u.created_at,
  ]);

  await recordAdminAction({
    actor: { id: user.id, role: staff.role },
    action: "export.users",
    targetType: "user",
    metadata: {
      rowCount: body.length,
      matchedTotal: total,
      truncated: exportTruncated(total),
      includesEmail: true,
      filters: { q, suspendedOnly },
    },
  });

  return csvResponse(csvFilename("users"), toCsv(HEADERS, body));
}
