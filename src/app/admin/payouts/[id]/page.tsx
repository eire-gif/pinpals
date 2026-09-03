import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/admin/authorization";
import { FINANCE_ROLES } from "@/lib/admin/finance";
import { getSellerAccountDetail } from "@/lib/admin/queries";
import { formatDateTime } from "@/lib/admin/format";
import { sellerAccountStatusLabel, SELLER_ACCOUNT_STATUS_STYLES } from "@/lib/format";
import AdminAvatar from "@/components/admin/avatar";
import SimpleActionForm from "@/components/admin/simple-action-form";
import { refreshSellerAccountStatus } from "./actions";

export default async function AdminSellerAccountDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireStaff({ roles: FINANCE_ROLES });
  const { id } = await params;

  // `id` here is the Pinpals user id, not the connected-account row's own
  // bigint id — see the comment on getSellerAccountDetail() in queries.ts for
  // why: it's what a link from /admin/users/[id] already has on hand.
  const detail = await getSellerAccountDetail(id);
  if (!detail) notFound();

  const { account, seller, history } = detail;
  const sellerName = seller ? `${seller.first_name} ${seller.last_name}`.trim() : "Unknown member";
  const label = sellerAccountStatusLabel(account);
  const badgeStyle = SELLER_ACCOUNT_STATUS_STYLES[label] ?? "bg-cream-100 text-ink-900";

  return (
    <div>
      <Link href="/admin/payouts" className="text-sm text-ink-500 hover:text-ink-900 mb-4 inline-block">
        ← All payouts
      </Link>

      <div className="bg-surface border border-line rounded-2xl p-6 shadow-sm mb-8">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <AdminAvatar name={sellerName} color={seller?.avatar_color ?? null} size="lg" />
            <div>
              <div className="text-xs uppercase tracking-wide text-ink-500 font-semibold">Seller account</div>
              {seller ? (
                <Link href={`/admin/users/${seller.id}`} className="font-display font-bold text-2xl hover:underline">
                  {sellerName}
                </Link>
              ) : (
                <h1 className="font-display font-bold text-2xl">{sellerName}</h1>
              )}
              <p className="text-ink-500 mt-1 font-mono text-xs">{account.stripe_account_id}</p>
            </div>
          </div>
          <span className={`inline-block text-xs font-bold px-2.5 py-1 rounded-full whitespace-nowrap ${badgeStyle}`}>
            {label}
          </span>
        </div>

        <p className="text-xs text-ink-500 mt-4">
          This is a cached copy of what Stripe last reported — not a live balance or ledger, and not a
          Pinpals-invented status. {account.last_synced_at
            ? `Last synced ${formatDateTime(account.last_synced_at)}.`
            : "Never synced yet."}
        </p>
      </div>

      <Section title="Operational status">
        <div className="p-5 grid sm:grid-cols-2 gap-4 text-sm">
          <Row label="Details submitted" value={account.details_submitted ? "Yes" : "No"} />
          <Row label="Charges enabled" value={account.charges_enabled ? "Yes" : "No"} />
          <Row label="Payouts enabled" value={account.payouts_enabled ? "Yes" : "No"} />
          {account.disabled_reason && <Row label="Disabled reason" value={account.disabled_reason} mono />}
        </div>
        {(account.requirements_currently_due.length > 0 || account.requirements_past_due.length > 0) && (
          <div className="px-5 pb-5 text-sm space-y-2">
            {account.requirements_past_due.length > 0 && (
              <p className="text-red-600">
                <span className="font-semibold">Past due:</span> {account.requirements_past_due.join(", ")}
              </p>
            )}
            {account.requirements_currently_due.length > 0 && (
              <p className="text-ink-500">
                <span className="font-semibold text-ink-900">Currently due:</span>{" "}
                {account.requirements_currently_due.join(", ")}
              </p>
            )}
          </div>
        )}
        <div className="px-5 pb-5">
          <SimpleActionForm
            action={refreshSellerAccountStatus}
            idField="userId"
            id={id}
            submitLabel="Refresh from Stripe"
            pendingLabel="Refreshing…"
          />
        </div>
      </Section>

      <Section title="Sync history">
        {history.length === 0 ? (
          <EmptyRow>No admin-triggered refreshes recorded yet — status has only ever come from the webhook.</EmptyRow>
        ) : (
          <ul>
            {history.map((entry) => (
              <li key={entry.id} className="px-5 py-3 border-b border-line last:border-0 text-sm">
                <span className="font-mono text-xs text-ink-900">{entry.action}</span>
                <span className="text-ink-500"> · {formatDateTime(entry.created_at)}</span>
                {entry.reason && <div className="text-ink-500 mt-1">{entry.reason}</div>}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-xs text-ink-500">{label}</div>
      <div className={`font-semibold text-ink-900 ${mono ? "font-mono text-xs" : ""}`}>{value}</div>
    </div>
  );
}

function Section({ title, children }: { title: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="mb-8">
      <h2 className="font-display font-bold text-lg mb-3">{title}</h2>
      <div className="bg-surface border border-line rounded-2xl overflow-hidden shadow-sm">{children}</div>
    </div>
  );
}

function EmptyRow({ children }: { children: React.ReactNode }) {
  return <div className="text-center py-10 text-ink-500 text-sm">{children}</div>;
}
