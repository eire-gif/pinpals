import type { NextRequest } from "next/server";
import { requireStaff } from "@/lib/admin/authorization";
import { FINANCE_ROLES } from "@/lib/admin/finance";
import { listPayouts } from "@/lib/admin/queries";
import { recordAdminAction } from "@/lib/admin/audit";
import { toCsv, type CsvValue } from "@/lib/admin/csv";
import { EXPORT_MAX_ROWS, csvFilename, csvResponse, exportTruncated } from "@/lib/admin/export";
import { PAYOUT_ROW_STATUS_LABELS, statusLabel } from "@/lib/admin/format";
import type { Payout } from "@/lib/types";

/**
 * CSV export of /admin/payouts/ledger — Pinpals' own timestamped record of
 * every Stripe payout, one row each. Gated to FINANCE_ROLES, exactly as the
 * page is. This is the file an accountant actually wants: amounts, dates,
 * statuses and failure reasons in a form that can be reconciled against a
 * bank statement.
 *
 * `livemode` is included on purpose. A ledger row from test mode looks
 * identical to a real one in every other column, and a test payout quietly
 * folded into a month's takings is the kind of error nobody finds until the
 * year-end. In the file it is one unambiguous column to filter on.
 *
 * Every figure here is a cached copy of what Stripe reported at
 * `last_synced_at` — that column is included so a stale row is visible as
 * stale rather than being read as current.
 */
export const dynamic = "force-dynamic";

const HEADERS = [
  "Payout ID",
  "Stripe payout ID",
  "Seller ID",
  "Seller name",
  "Seller email",
  "Stripe account ID",
  "Status",
  "Amount (EUR)",
  "Currency",
  "Method",
  "Type",
  "Live mode",
  "Failure code",
  "Failure message",
  "Arrival date",
  "Created at (Stripe)",
  "Last synced at",
] as const;

export async function GET(request: NextRequest) {
  const { user, staff } = await requireStaff({ roles: FINANCE_ROLES });

  const sp = request.nextUrl.searchParams;
  const seller = sp.get("seller") ?? "";
  const status = sp.get("status") ?? "";
  const blockedOnly = sp.get("blocked") === "1";

  const { rows, total } = await listPayouts(
    {
      seller: seller || undefined,
      // Mirrors the page exactly: "blocked only" supersedes the status
      // dropdown rather than combining with it (the page disables the
      // dropdown when it is on), so the file matches what was on screen.
      status: blockedOnly ? undefined : ((status || undefined) as Payout["status"] | undefined),
      blockedOnly: blockedOnly || undefined,
    },
    1,
    EXPORT_MAX_ROWS
  );

  const body: CsvValue[][] = rows.map((p) => [
    p.id,
    p.stripe_payout_id,
    p.user_id,
    p.seller ? `${p.seller.first_name} ${p.seller.last_name}`.trim() : null,
    p.seller?.email ?? null,
    p.stripe_account_id,
    statusLabel(PAYOUT_ROW_STATUS_LABELS, p.status),
    p.amount_eur,
    p.currency,
    p.method,
    p.type,
    p.livemode,
    p.failure_code,
    p.failure_message,
    p.arrival_date,
    p.stripe_created_at,
    p.last_synced_at,
  ]);

  await recordAdminAction({
    actor: { id: user.id, role: staff.role },
    action: "export.payouts",
    targetType: "payout",
    metadata: {
      rowCount: body.length,
      matchedTotal: total,
      truncated: exportTruncated(total),
      includesEmail: true,
      filters: { seller, status, blockedOnly },
    },
  });

  return csvResponse(csvFilename("payout-ledger"), toCsv(HEADERS, body));
}
