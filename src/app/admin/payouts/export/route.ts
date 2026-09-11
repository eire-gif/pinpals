import type { NextRequest } from "next/server";
import { requireStaff } from "@/lib/admin/authorization";
import { FINANCE_ROLES } from "@/lib/admin/finance";
import { listSellerAccounts } from "@/lib/admin/queries";
import { recordAdminAction } from "@/lib/admin/audit";
import { toCsv, type CsvValue } from "@/lib/admin/csv";
import {
  EXPORT_MAX_ROWS,
  csvFilename,
  csvList,
  csvResponse,
  exportTruncated,
} from "@/lib/admin/export";
import { sellerAccountStatusLabel } from "@/lib/format";

/**
 * CSV export of /admin/payouts — Stripe Connect onboarding and payout
 * readiness, one row per seller account. Gated to FINANCE_ROLES, exactly as
 * the page is.
 *
 * The seller's email is included for the same reason the orders export
 * includes it: the point of this file is chasing a specific seller whose
 * account is stuck, which needs a way to reach them.
 *
 * `requirements_currently_due` and `requirements_past_due` carry Stripe's
 * requirement *codes* ("individual.verification.document"), never the
 * documents or values submitted for them — that data never reaches this
 * database at all. They are the whole reason this export is useful: a
 * filtered "needs attention" file says exactly what each stuck seller is
 * waiting on.
 */
export const dynamic = "force-dynamic";

const HEADERS = [
  "Seller ID",
  "Seller name",
  "Seller email",
  "Stripe account ID",
  "Status",
  "Charges enabled",
  "Payouts enabled",
  "Details submitted",
  "Requirements currently due",
  "Requirements past due",
  "Disabled reason",
  "Last synced at",
  "Connected at",
  "Updated at",
] as const;

export async function GET(request: NextRequest) {
  const { user, staff } = await requireStaff({ roles: FINANCE_ROLES });

  const sp = request.nextUrl.searchParams;
  const seller = sp.get("seller") ?? "";
  const needsAttention = sp.get("attention") === "1";

  const { rows, total } = await listSellerAccounts(
    { seller: seller || undefined, needsAttention: needsAttention || undefined },
    1,
    EXPORT_MAX_ROWS
  );

  const body: CsvValue[][] = rows.map((a) => [
    a.user_id,
    a.seller ? `${a.seller.first_name} ${a.seller.last_name}`.trim() : null,
    a.seller?.email ?? null,
    a.stripe_account_id,
    // The same one-line verdict the page shows in its status column, rather
    // than leaving whoever opens the file to derive it from the three
    // booleans beside it — and derive it differently from the page.
    sellerAccountStatusLabel(a),
    a.charges_enabled,
    a.payouts_enabled,
    a.details_submitted,
    csvList(a.requirements_currently_due),
    csvList(a.requirements_past_due),
    a.disabled_reason,
    a.last_synced_at,
    a.created_at,
    a.updated_at,
  ]);

  await recordAdminAction({
    actor: { id: user.id, role: staff.role },
    action: "export.seller_accounts",
    targetType: "seller_account",
    metadata: {
      rowCount: body.length,
      matchedTotal: total,
      truncated: exportTruncated(total),
      includesEmail: true,
      filters: { seller, needsAttention },
    },
  });

  return csvResponse(csvFilename("seller-accounts"), toCsv(HEADERS, body));
}
