import "server-only";
import type { StaffRole } from "./roles";

/**
 * Shared plumbing for the three /admin CSV export routes
 * (src/app/admin/{listings,orders,users}/export/route.ts).
 *
 * Design notes:
 *
 *   * Each route reuses the SAME list query its page uses
 *     (listListings/listOrders/listUsers), passing EXPORT_MAX_ROWS as the
 *     page size instead of the page's own 20. That's the whole reason those
 *     three functions grew an optional `pageSize` parameter — an export must
 *     never re-implement filter logic, or it will drift from what the admin
 *     sees on screen and quietly export a different set of rows than the one
 *     they were looking at.
 *
 *   * An export is therefore "everything matching the filters currently in
 *     the URL", not "everything in the table". An admin who filtered to
 *     Dublin gets Dublin. Clearing the filters first is how you get the lot.
 *
 *   * Every export is written to admin_audit_log before the file is
 *     returned, including the filters used and the row count. A CSV leaves
 *     the system and can't be recalled, so who pulled what, and when, is
 *     worth strictly more than the usual read-only-pages-aren't-audited rule
 *     this app follows elsewhere (see seller_account.synced's comment in
 *     audit.ts).
 */

/**
 * Hard ceiling on rows in a single export. Deliberately a cap rather than
 * cursor pagination: these three routes build the whole CSV in memory and
 * hand it back as one response, and 5k rows of listings/orders/users is
 * comfortably inside a serverless function's memory and time budget, while
 * being far more than this marketplace will need for a long while. The route
 * tells the admin when the cap was hit (see exportTruncated) rather than
 * silently returning a partial file — a truncated export nobody noticed is
 * exactly how a "the numbers don't add up" incident starts.
 */
export const EXPORT_MAX_ROWS = 5000;

/**
 * The users export carries every member's email address, so it is gated
 * harder than /admin/users itself (which any active staff member can view).
 * Listings and orders exports match their own pages' existing gates: any
 * staff, and FINANCE_ROLES respectively.
 */
export const USER_EXPORT_ROLES = ["super_admin"] as const satisfies readonly StaffRole[];

/** `pinpals-listings-2026-09-09.csv` — dated so an admin with several
 * exports in their Downloads folder can tell them apart without opening
 * them. Date only, not time: two exports on one day overwrite in a way the
 * browser disambiguates itself (`… (1).csv`). */
export function csvFilename(dataset: string, now: Date = new Date()): string {
  const day = now.toISOString().slice(0, 10);
  return `pinpals-${dataset}-${day}.csv`;
}

/**
 * The UTF-8 BOM. Without it Excel on Windows reads a UTF-8 CSV as the
 * system's legacy codepage, and every non-ASCII character in a member's name
 * or a club name ("Portmarnock", "Dún Laoghaire") arrives mangled. Every
 * other consumer tolerates the BOM.
 */
const UTF8_BOM = "﻿";

export function csvResponse(filename: string, csv: string): Response {
  return new Response(UTF8_BOM + csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      // The quotes matter: a filename with a space would otherwise be
      // truncated at it by some browsers. csvFilename() never produces one,
      // but this file is the place that guarantee should live.
      "content-disposition": `attachment; filename="${filename}"`,
      // Same posture as every other /admin response (see src/proxy.ts) —
      // this one contains member data and must never sit in a shared cache.
      "cache-control": "private, no-store, max-age=0",
    },
  });
}

/** True when the result set was clipped by EXPORT_MAX_ROWS — surfaced to the
 * caller so the route can say so in the audit metadata. */
export function exportTruncated(total: number): boolean {
  return total > EXPORT_MAX_ROWS;
}
