import Link from "next/link";
import { requireStaff } from "@/lib/admin/authorization";
import { FINANCE_ROLES } from "@/lib/admin/finance";
import { canAccess } from "@/lib/admin/roles";
import {
  STORE_STATUSES,
  formatCommissionRate,
  listStoresForAdmin,
  type AdminStoreRow,
  type StoreStatus,
} from "@/lib/admin/marketplace-revenue";
import { formatDateTime, personName } from "@/lib/admin/format";
import { formatPrice } from "@/lib/format";
import SimpleActionForm from "@/components/admin/simple-action-form";
import FieldsActionForm from "@/components/admin/fields-action-form";
import StatusBadge from "@/components/admin/status-badge";
import AdminRowActions from "@/components/admin/controls/row-actions";
import { BulkProvider, BulkBar, SelectRow } from "@/components/admin/controls/bulk";
import { bulkBarProps, rowActionProps } from "@/lib/admin/controls";
import type { StaffRecord } from "@/lib/admin/roles";
import { approveStore, setStoreCommission } from "./growth-actions";

const STORE_STATUS_LABELS: Record<StoreStatus, string> = {
  pending: "Awaiting approval",
  active: "Active",
  suspended: "Suspended",
};

const STORE_STATUS_STYLES: Record<StoreStatus, string> = {
  pending: "bg-gold-500/20 text-gold-700",
  active: "bg-green-100 text-green-800",
  suspended: "bg-red-100 text-red-600",
};

const SECTION_TITLES: Record<StoreStatus, string> = {
  pending: "Awaiting approval",
  active: "Active shops",
  suspended: "Suspended",
};

// Pro shops (0115). Any active staff member may look; approving, suspending,
// reinstating and changing commission are FINANCE_ROLES decisions, and each
// action re-checks that itself (see growth-actions.ts).
export default async function ShopsTab() {
  const { staff } = await requireStaff();
  const canAct = canAccess(staff, FINANCE_ROLES);
  const stores = await listStoresForAdmin();

  return (
    <div>
      <h2 className="font-display font-bold text-lg mb-1">Pro shops</h2>
      <p className="text-sm text-ink-500 mb-6">
        Club pro shops selling new stock. Suspending a shop stops it adding stock; its listings stay up (remove them from{" "}
        <Link href="/admin/listings" className="underline">
          Listings
        </Link>
        ).{!canAct && " Approving and commission changes need a finance role."}
      </p>

      {stores.length === 0 && (
        <p className="text-sm text-ink-500 bg-surface border border-line rounded-2xl p-6">No shops have applied yet.</p>
      )}

      {STORE_STATUSES.map((status) => {
        const rows = stores.filter((s) => s.status === status);
        if (rows.length === 0) return null;
        return (
          <section key={status} className="mb-8">
            <h3 className="font-display font-bold text-base mb-3">
              {SECTION_TITLES[status]} <span className="text-ink-500 font-normal">({rows.length})</span>
            </h3>
            <BulkProvider>
              <div className="grid gap-4">
                {rows.map((s) => (
                  <StoreCard key={s.id} store={s} canAct={canAct} staff={staff} />
                ))}
              </div>
              <BulkBar {...bulkBarProps(staff, "store")} />
            </BulkProvider>
          </section>
        );
      })}
    </div>
  );
}

function StoreCard({ store: s, canAct, staff }: { store: AdminStoreRow; canAct: boolean; staff: StaffRecord }) {
  return (
    <div className="bg-surface border border-line rounded-2xl p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="pt-1.5">
            <SelectRow id={s.id} label={`Select ${s.name}`} />
          </div>
          <div>
          <div className="flex items-center gap-2">
            <Link href={`/admin/records/store/${s.id}`} className="font-display font-bold text-ink-900 text-lg hover:underline">
              {s.name}
            </Link>
            <StatusBadge status={s.status} labels={STORE_STATUS_LABELS} styles={STORE_STATUS_STYLES} />
            <AdminRowActions {...rowActionProps(staff, "store", s.id, { hidden: s.status === "suspended" }, s.name)} />
          </div>
          <div className="text-sm text-ink-500 mt-1">
            {personName(s.owner)} · {s.clubName ?? "No club"} · applied {formatDateTime(s.created_at)}
            {s.approved_at && <> · approved {formatDateTime(s.approved_at)}</>}
          </div>
          <div className="text-xs text-ink-500 mt-0.5">/{s.slug}</div>
          </div>
        </div>
        <dl className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
          <Fact label="In stock" value={String(s.itemsInStock)} />
          <Fact label="Sales" value={String(s.salesCount)} />
          <Fact label="Commission earned" value={formatPrice(s.commissionEur)} />
          <Fact label="Rate" value={formatCommissionRate(s.commission_rate)} />
        </dl>
      </div>

      {canAct && (
        <div className="mt-4 pt-4 border-t border-line grid md:grid-cols-2 gap-5">
          <div>
            {s.status === "pending" ? (
              <SimpleActionForm action={approveStore} idField="storeId" id={s.id} submitLabel="Approve shop" pendingLabel="Approving…" successLabel="Approved — the owner has been notified." />
            ) : (
              <p className="text-sm text-ink-500">Suspend, reinstate, edit or delete from the &ldquo;⋯&rdquo; menu.</p>
            )}
          </div>
          <FieldsActionForm action={setStoreCommission} submitLabel="Set commission" pendingLabel="Saving…" className="grid gap-2">
            <input type="hidden" name="storeId" value={s.id} />
            <label className="text-xs uppercase tracking-wide text-ink-500 font-semibold" htmlFor={`commission-${s.id}`}>
              Commission rate (%)
            </label>
            <div className="flex gap-2">
              <input
                id={`commission-${s.id}`}
                name="commissionPercent"
                type="number"
                min={0}
                max={50}
                step={0.1}
                required
                defaultValue={Math.round(s.commission_rate * 1000) / 10}
                className="w-24 text-sm rounded-lg border-[1.5px] border-line px-3 py-2 bg-surface"
              />
              <input
                name="reason"
                placeholder="Reason (optional, audit log)"
                className="flex-1 text-sm rounded-lg border-[1.5px] border-line px-3 py-2 bg-surface"
              />
            </div>
          </FieldsActionForm>
        </div>
      )}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-ink-500 font-semibold">{label}</dt>
      <dd className="font-bold text-ink-900">{value}</dd>
    </div>
  );
}
