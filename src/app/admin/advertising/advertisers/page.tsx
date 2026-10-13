import Link from "next/link";
import { requireStaff } from "@/lib/admin/authorization";
import {
  AdvertisingNotInstalledError,
  canEditAdvertising,
  listAdvertisers,
  listCampaigns,
  type Advertiser,
  type CampaignListItem,
} from "@/lib/admin/advertising";
import FieldsActionForm from "@/components/admin/fields-action-form";
import { AdvertisingHeader, NewCampaignLink, NotInstalled, eur } from "../bits";
import { saveAdvertiser } from "../actions";

// /admin/advertising/advertisers — who buys advertising, with what they've
// run and earned. Contact details are staff-only (0139 RLS); any active staff
// member may look, editors may add and edit.
export default async function AdvertisersPage() {
  const { staff } = await requireStaff();
  const canEdit = canEditAdvertising(staff.role);

  let advertisers: Advertiser[];
  let campaigns: CampaignListItem[];
  try {
    [advertisers, campaigns] = await Promise.all([listAdvertisers(), listCampaigns()]);
  } catch (err) {
    if (err instanceof AdvertisingNotInstalledError) return <NotInstalled />;
    throw err;
  }

  return (
    <div>
      <AdvertisingHeader
        current="/admin/advertising/advertisers"
        title="Advertisers"
        subtitle="The businesses that buy space. Their contact details are only ever seen by PinPals staff."
        actions={canEdit ? <NewCampaignLink /> : null}
      />

      {advertisers.length === 0 ? (
        <p className="text-sm text-ink-500 bg-surface border border-line rounded-2xl p-6 mb-6">No advertisers yet.</p>
      ) : (
        <div className="grid gap-3 mb-8">
          {advertisers.map((a) => {
            const theirs = campaigns.filter((c) => c.advertiser_id === a.id);
            const earned = theirs.reduce((sum, c) => sum + Math.round(c.summary.earnedEur * 100), 0) / 100;
            const outstanding = theirs.reduce((sum, c) => sum + Math.round(c.summary.outstandingEur * 100), 0) / 100;
            return (
              <div key={a.id} className="bg-surface border border-line rounded-2xl p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="font-display font-bold text-lg text-ink-900">{a.name}</div>
                    <div className="text-sm text-ink-500">
                      {[a.contact_name, a.email, a.phone].filter(Boolean).join(" · ") || "No contact details"}
                    </div>
                    {a.website && (
                      <a href={a.website} target="_blank" rel="noopener noreferrer" className="text-xs underline text-ink-500 break-all">
                        {a.website}
                      </a>
                    )}
                  </div>
                  <dl className="grid grid-cols-3 gap-5 text-sm">
                    <Fact label="Campaigns" value={String(theirs.length)} />
                    <Fact label="Earned" value={eur(earned)} />
                    <Fact label="Outstanding" value={eur(outstanding)} />
                  </dl>
                </div>
                {theirs.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-3">
                    {theirs.map((c) => (
                      <Link key={c.id} href={`/admin/advertising/${c.id}`} className="text-xs font-semibold rounded-full border border-line px-3 py-1 hover:bg-cream-100">
                        {c.name}
                      </Link>
                    ))}
                  </div>
                )}
                {a.notes && <p className="text-xs text-ink-500 mt-3 whitespace-pre-line">{a.notes}</p>}
                {canEdit && (
                  <details className="mt-3">
                    <summary className="text-sm text-ink-500 cursor-pointer py-1">Edit…</summary>
                    <div className="mt-2">
                      <FieldsActionForm action={saveAdvertiser} submitLabel="Save advertiser" pendingLabel="Saving…">
                        <input type="hidden" name="advertiserId" value={a.id} />
                        <AdvertiserFields advertiser={a} />
                      </FieldsActionForm>
                    </div>
                  </details>
                )}
              </div>
            );
          })}
        </div>
      )}

      {canEdit && (
        <details className="bg-surface border border-line rounded-2xl p-5" open={advertisers.length === 0}>
          <summary className="font-bold text-sm cursor-pointer text-green-700">+ New advertiser</summary>
          <div className="mt-4">
            <FieldsActionForm action={saveAdvertiser} submitLabel="Add advertiser" pendingLabel="Adding…" resetOnSuccess successLabel="Advertiser added.">
              <AdvertiserFields />
            </FieldsActionForm>
          </div>
        </details>
      )}
    </div>
  );
}

const inputCls = "w-full text-sm rounded-lg border-[1.5px] border-line px-3 py-2 bg-surface";

function Field({ label, children, wide = false }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <label className={`grid gap-1 ${wide ? "sm:col-span-2" : ""}`}>
      <span className="text-xs uppercase tracking-wide text-ink-500 font-semibold">{label}</span>
      {children}
    </label>
  );
}

function AdvertiserFields({ advertiser }: { advertiser?: Advertiser }) {
  return (
    <div className="grid sm:grid-cols-2 gap-3">
      <Field label="Business name *">
        <input name="name" required minLength={2} maxLength={120} defaultValue={advertiser?.name} className={inputCls} />
      </Field>
      <Field label="Contact name">
        <input name="contact_name" maxLength={120} defaultValue={advertiser?.contact_name ?? ""} className={inputCls} />
      </Field>
      <Field label="Email">
        <input name="email" type="email" maxLength={200} defaultValue={advertiser?.email ?? ""} className={inputCls} />
      </Field>
      <Field label="Phone">
        <input name="phone" maxLength={40} defaultValue={advertiser?.phone ?? ""} className={inputCls} />
      </Field>
      <Field label="Website" wide>
        <input name="website" type="url" maxLength={500} defaultValue={advertiser?.website ?? ""} placeholder="https://" className={inputCls} />
      </Field>
      <Field label="Logo URL (https://, upload it in a course-partner campaign)" wide>
        <input name="logo_url" type="url" pattern="https://.*" maxLength={500} defaultValue={advertiser?.logo_url ?? ""} className={inputCls} />
      </Field>
      <Field label="Notes (staff only)" wide>
        <textarea name="notes" maxLength={4000} rows={3} defaultValue={advertiser?.notes ?? ""} className={inputCls} />
      </Field>
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
