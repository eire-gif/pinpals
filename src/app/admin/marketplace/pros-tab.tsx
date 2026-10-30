import { requireStaff } from "@/lib/admin/authorization";
import { FINANCE_ROLES } from "@/lib/admin/finance";
import { canAccess } from "@/lib/admin/roles";
import { formatDateTime } from "@/lib/admin/format";
import { formatPriceCents } from "@/lib/format";
import { createAdminClient } from "@/lib/supabase/admin";
import SimpleActionForm from "@/components/admin/simple-action-form";
import FieldsActionForm from "@/components/admin/fields-action-form";
import { approvePro, declinePro } from "./growth-actions";

type ProRow = {
  id: number;
  kind: "pga" | "teaching" | "fitter";
  pga_number: string | null;
  qualification: string | null;
  club: string;
  county: string | null;
  bio: string | null;
  cancel_policy: "24h" | "48h" | "none";
  status: "pending" | "approved" | "declined" | "paused";
  decline_reason: string | null;
  created_at: string;
  reviewed_at: string | null;
  profiles: { first_name: string; last_name: string | null; email?: string | null } | null;
};

const KIND: Record<ProRow["kind"], string> = { pga: "PGA professional", teaching: "Teaching pro", fitter: "Club fitter" };
const POLICY: Record<ProRow["cancel_policy"], string> = { "24h": "Free cancel up to 24h", "48h": "Free cancel up to 48h", none: "No refunds" };
const SECTIONS: { status: ProRow["status"]; title: string }[] = [
  { status: "pending", title: "Waiting for approval" },
  { status: "approved", title: "Live" },
  { status: "paused", title: "Paused by the pro" },
  { status: "declined", title: "Declined" },
];

// Book a pro (0204). Any staff member may look; approving and declining are
// FINANCE_ROLES decisions (money flows to these accounts), re-checked in
// growth-actions.ts. Check a PGA number with the PGA, or a qualification
// with whoever issued it, before approving.
export default async function ProsTab() {
  const { staff } = await requireStaff();
  const canAct = canAccess(staff, FINANCE_ROLES);
  const admin = createAdminClient();
  const [{ data: pros }, { data: bookings }] = await Promise.all([
    admin
      .from("pros")
      .select("id, kind, pga_number, qualification, club, county, bio, cancel_policy, status, decline_reason, created_at, reviewed_at, profiles!pros_member_id_fkey(first_name, last_name)")
      .order("created_at", { ascending: false })
      .limit(500),
    admin.from("pro_bookings").select("pro_id, commission_cents, payout_status").eq("payment_status", "paid").limit(5000),
  ]);
  const rows = (pros ?? []) as unknown as ProRow[];
  const stats = new Map<number, { lessons: number; commission: number }>();
  for (const b of (bookings ?? []) as { pro_id: number; commission_cents: number; payout_status: string }[]) {
    const s = stats.get(b.pro_id) ?? { lessons: 0, commission: 0 };
    s.lessons += 1;
    if (b.payout_status === "released" || b.payout_status === "held") s.commission += b.commission_cents;
    stats.set(b.pro_id, s);
  }

  return (
    <div>
      <h2 className="font-display font-bold text-lg mb-1">Pros</h2>
      <p className="text-sm text-ink-500 mb-6">
        PGA professionals, teaching pros and club fitters who take bookings. PinPals keeps 10% of each lesson.
        {!canAct && " Approving and declining need a finance role."}
      </p>
      {rows.length === 0 && <p className="text-sm text-ink-500 bg-surface border border-line rounded-2xl p-6">No pros have applied yet.</p>}
      {SECTIONS.map(({ status, title }) => {
        const list = rows.filter((r) => r.status === status);
        if (list.length === 0) return null;
        return (
          <section key={status} className="mb-8">
            <h3 className="font-display font-bold text-base mb-3">
              {title} <span className="text-ink-500 font-normal">({list.length})</span>
            </h3>
            <div className="grid gap-4">
              {list.map((p) => {
                const s = stats.get(p.id) ?? { lessons: 0, commission: 0 };
                const name = p.profiles ? `${p.profiles.first_name} ${p.profiles.last_name ?? ""}`.trim() : "Member";
                return (
                  <div key={p.id} className="bg-surface border border-line rounded-2xl p-5">
                    <div className="flex flex-wrap justify-between gap-3">
                      <div>
                        <div className="font-display font-bold text-lg">{name}</div>
                        <div className="text-sm text-ink-500">
                          {KIND[p.kind]} · {p.club}
                          {p.county ? `, Co. ${p.county}` : ""} · applied {formatDateTime(p.created_at)}
                        </div>
                        <div className="text-sm mt-1">
                          {p.kind === "pga" ? (
                            <>
                              PGA number: <b>{p.pga_number}</b>
                            </>
                          ) : (
                            <>
                              Qualification: <b>{p.qualification}</b>
                            </>
                          )}{" "}
                          · {POLICY[p.cancel_policy]}
                        </div>
                        {p.bio && <p className="text-sm text-ink-500 mt-2 max-w-xl whitespace-pre-line">{p.bio}</p>}
                        {p.decline_reason && <p className="text-sm text-red-600 mt-2">Declined: {p.decline_reason}</p>}
                      </div>
                      <dl className="grid grid-cols-2 gap-4 text-sm">
                        <div>
                          <dt className="text-[11px] uppercase tracking-wide text-ink-500 font-semibold">Lessons paid</dt>
                          <dd className="font-bold">{s.lessons}</dd>
                        </div>
                        <div>
                          <dt className="text-[11px] uppercase tracking-wide text-ink-500 font-semibold">PinPals&apos; 10%</dt>
                          <dd className="font-bold">{formatPriceCents(s.commission)}</dd>
                        </div>
                      </dl>
                    </div>
                    {canAct && p.status === "pending" && (
                      <div className="mt-4 pt-4 border-t border-line grid md:grid-cols-2 gap-5">
                        <SimpleActionForm action={approvePro} idField="proId" id={p.id} submitLabel="Approve" pendingLabel="Approving…" successLabel="Approved — they've been told." />
                        <FieldsActionForm action={declinePro} submitLabel="Decline" pendingLabel="Declining…" className="grid gap-2" successLabel="Declined — they've been told why.">
                          <input type="hidden" name="proId" value={p.id} />
                          <input
                            name="reason"
                            required
                            placeholder="Why (they'll see this)"
                            className="text-sm rounded-lg border-[1.5px] border-line px-3 py-2 bg-surface"
                          />
                        </FieldsActionForm>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
