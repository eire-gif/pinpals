import type { NextRequest } from "next/server";
import { requireStaff } from "@/lib/admin/authorization";
import { FINANCE_ROLES } from "@/lib/admin/finance";
import { listOrders } from "@/lib/admin/queries";
import { recordAdminAction } from "@/lib/admin/audit";
import { toCsv, type CsvValue } from "@/lib/admin/csv";
import { EXPORT_MAX_ROWS, csvFilename, csvResponse, exportTruncated } from "@/lib/admin/export";
import {
  ORDER_STATUS_LABELS,
  PAYMENT_STATUS_LABELS,
  statusLabel,
} from "@/lib/admin/format";

/**
 * CSV export of /admin/orders. Gated to FINANCE_ROLES, exactly as the page
 * is — orders are a finance concern, not general moderation, and
 * support/moderator get the same 404 here that they get on the page.
 *
 * Buyer and seller emails are included: an order export's whole purpose is
 * reconciliation and chasing a specific transaction, which needs a way to
 * identify the two parties. `delivery_detail` (the buyer's postal address,
 * snapshotted at checkout) is deliberately NOT included — reconciling
 * payments never needs it, and a spreadsheet of members' home addresses is
 * exactly the file you don't want sitting in someone's Downloads folder.
 * Add it only if a real fulfilment workflow needs it, and audit that
 * decision separately.
 */
export const dynamic = "force-dynamic";

const HEADERS = [
  "Order ID",
  "Status",
  "Payment status",
  "Listing ID",
  "Listing title",
  "Amount (EUR)",
  "Platform fee (EUR)",
  "Delivery fee (EUR)",
  "Total (EUR)",
  "Currency",
  "Delivery method",
  "Buyer ID",
  "Buyer name",
  "Buyer email",
  "Seller ID",
  "Seller name",
  "Seller email",
  "Payment reference",
  "Created at",
  "Completed at",
] as const;

export async function GET(request: NextRequest) {
  const { user, staff } = await requireStaff({ roles: FINANCE_ROLES });

  const sp = request.nextUrl.searchParams;
  const idParam = sp.get("id") ?? "";
  const buyer = sp.get("buyer") ?? "";
  const seller = sp.get("seller") ?? "";
  const status = sp.get("status") ?? "";
  const payment = sp.get("payment") ?? "";
  const from = sp.get("from") ?? "";
  const to = sp.get("to") ?? "";

  const parsedId = idParam.trim() ? Number.parseInt(idParam, 10) : undefined;

  const { rows, total } = await listOrders(
    {
      orderId: parsedId && Number.isFinite(parsedId) ? parsedId : undefined,
      buyer: buyer || undefined,
      seller: seller || undefined,
      status: status || undefined,
      paymentStatus: payment || undefined,
      from: from || undefined,
      to: to ? `${to}T23:59:59.999Z` : undefined,
    },
    1,
    EXPORT_MAX_ROWS
  );

  const body: CsvValue[][] = rows.map((o) => [
    o.id,
    statusLabel(ORDER_STATUS_LABELS, o.status),
    statusLabel(PAYMENT_STATUS_LABELS, o.payment_status),
    o.listing_id,
    o.listing_title,
    o.amount_eur,
    o.platform_fee_eur,
    // Stored in cents (0034); every other money column on this row is euro,
    // so it is converted here rather than exported in a different unit from
    // its neighbours.
    o.delivery_fee_cents == null ? null : (o.delivery_fee_cents / 100).toFixed(2),
    o.total_eur,
    o.currency,
    o.delivery_method,
    o.buyer?.id ?? null,
    o.buyer ? `${o.buyer.first_name} ${o.buyer.last_name}`.trim() : null,
    o.buyer?.email ?? null,
    o.seller?.id ?? null,
    o.seller ? `${o.seller.first_name} ${o.seller.last_name}`.trim() : null,
    o.seller?.email ?? null,
    o.payment_reference,
    o.created_at,
    o.completed_at,
  ]);

  await recordAdminAction({
    actor: { id: user.id, role: staff.role },
    action: "export.orders",
    targetType: "order",
    metadata: {
      rowCount: body.length,
      matchedTotal: total,
      truncated: exportTruncated(total),
      filters: { id: idParam, buyer, seller, status, payment, from, to },
    },
  });

  return csvResponse(csvFilename("orders"), toCsv(HEADERS, body));
}
