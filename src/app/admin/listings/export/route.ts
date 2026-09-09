import type { NextRequest } from "next/server";
import { requireStaff } from "@/lib/admin/authorization";
import { listListings } from "@/lib/admin/queries";
import { recordAdminAction } from "@/lib/admin/audit";
import { toCsv, type CsvValue } from "@/lib/admin/csv";
import { EXPORT_MAX_ROWS, csvFilename, csvResponse, exportTruncated } from "@/lib/admin/export";
import { LISTING_STATUS_LABELS, statusLabel } from "@/lib/admin/format";

/**
 * CSV export of /admin/listings, honouring the exact same filters the page
 * does — the query string this route receives is the one from the page the
 * admin was looking at (see the Export CSV link in ../page.tsx).
 *
 * Access matches the page itself: any active staff role. A listing is
 * already public once active, and this file carries no buyer data — the
 * seller's name and county are the only personal fields, both of which
 * appear on the public listing page anyway.
 */
export const dynamic = "force-dynamic";

const HEADERS = [
  "Listing ID",
  "Title",
  "Status",
  "Sale type",
  "Category",
  "Subcategory",
  "Condition",
  "County",
  "Price (EUR)",
  "Seller ID",
  "Seller name",
  "Seller club",
  "Delivery options",
  "Created at",
  "Updated at",
] as const;

export async function GET(request: NextRequest) {
  const { user, staff } = await requireStaff();

  const sp = request.nextUrl.searchParams;
  const q = sp.get("q") ?? "";
  const status = sp.get("status") ?? "";
  const category = sp.get("category") ?? "";
  const county = sp.get("county") ?? "";
  const seller = sp.get("seller") ?? "";
  const from = sp.get("from") ?? "";
  const to = sp.get("to") ?? "";

  const { rows, total } = await listListings(
    q,
    {
      status: status || undefined,
      category: category || undefined,
      county: county || undefined,
      sellerId: seller || undefined,
      from: from || undefined,
      // Inclusive whole day — identical to ../page.tsx, and it has to stay
      // identical or the export would silently cover a different range than
      // the screen the admin launched it from.
      to: to ? `${to}T23:59:59.999Z` : undefined,
    },
    1,
    EXPORT_MAX_ROWS
  );

  const body: CsvValue[][] = rows.map((l) => [
    l.id,
    l.title,
    statusLabel(LISTING_STATUS_LABELS, l.status),
    l.sale_type,
    l.category,
    l.subcategory,
    l.condition,
    l.county,
    l.price_eur,
    l.seller?.id ?? null,
    l.seller ? `${l.seller.first_name} ${l.seller.last_name}`.trim() : null,
    l.seller?.home_club ?? null,
    (l.delivery_options ?? []).join(" | "),
    l.created_at,
    l.updated_at,
  ]);

  await recordAdminAction({
    actor: { id: user.id, role: staff.role },
    action: "export.listings",
    targetType: "listing",
    metadata: {
      rowCount: body.length,
      matchedTotal: total,
      truncated: exportTruncated(total),
      filters: { q, status, category, county, seller, from, to },
    },
  });

  return csvResponse(csvFilename("listings"), toCsv(HEADERS, body));
}
