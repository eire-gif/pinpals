import Link from "next/link";
import { requireStaff } from "@/lib/admin/authorization";
import { FINANCE_ROLES } from "@/lib/admin/finance";
import { listSellerAccounts } from "@/lib/admin/queries";
import { formatDateTime, personName } from "@/lib/admin/format";
import AdminAvatar from "@/components/admin/avatar";
import AdminPagination from "@/components/admin/pagination";

// Connect onboarding readiness itself already lives in full at
// /admin/payouts — this is that same listSellerAccounts() function, just
// pre-filtered to needsAttention (payouts_enabled = false), the "who do I
// need to chase" view. Never shows a bank/card detail or any raw Stripe
// payload — StripeConnectedAccount only ever stores status flags and
// requirement CODES (e.g. "individual.verification.document"), never the
// values submitted for them — see that type's own comment in
// src/lib/types.ts.
export default async function SellersTab({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  await requireStaff({ roles: FINANCE_ROLES });

  const page = Number(searchParams.sellersPage ?? "1") || 1;
  const { rows, total, pageSize } = await listSellerAccounts({ needsAttention: true }, page);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-display font-bold text-lg">Sellers needing Connect attention</h2>
        <Link href="/admin/payouts" className="text-sm underline">
          View all seller accounts →
        </Link>
      </div>
      <p className="text-sm text-ink-500 mb-4">Payouts disabled — onboarding incomplete or a requirement is due.</p>

      {rows.length === 0 ? (
        <p className="text-sm text-ink-500 bg-surface border border-line rounded-2xl p-6">
          Every seller with a connected account can currently receive payouts.
        </p>
      ) : (
        <div className="bg-surface border border-line rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-cream-100 text-left text-xs uppercase tracking-wide text-ink-500">
              <tr>
                <th className="px-5 py-3">Seller</th>
                <th className="px-5 py-3">Charges</th>
                <th className="px-5 py-3">Payouts</th>
                <th className="px-5 py-3">Requirements past due</th>
                <th className="px-5 py-3">Last synced</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((a) => (
                <tr key={a.id}>
                  <td className="px-5 py-3 font-semibold text-ink-900">
                    <div className="flex items-center gap-2">
                      <AdminAvatar name={personName(a.seller)} color={a.seller?.avatar_color ?? null} />
                      <span>{personName(a.seller)}</span>
                    </div>
                  </td>
                  <td className="px-5 py-3">{a.charges_enabled ? "Enabled" : "Disabled"}</td>
                  <td className="px-5 py-3">{a.payouts_enabled ? "Enabled" : "Disabled"}</td>
                  <td className="px-5 py-3 text-ink-500">{a.requirements_past_due.length || "—"}</td>
                  <td className="px-5 py-3 text-ink-500">
                    {a.last_synced_at ? formatDateTime(a.last_synced_at) : "Never"}
                  </td>
                  <td className="px-5 py-3 text-right">
                    <Link href={`/admin/payouts/${a.user_id}`} className="text-sm underline">
                      Open →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <AdminPagination
        page={page}
        pageSize={pageSize}
        total={total}
        hrefForPage={(p) => `/admin/marketplace?tab=sellers&sellersPage=${p}`}
      />
    </div>
  );
}
